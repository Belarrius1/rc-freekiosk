import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Keyboard,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import QRCode from 'react-native-qrcode-svg';
import { RC_THEME } from '../theme/relicCommanderTheme';
import {
  authenticateRcTerminal,
  loadRcTerminalAssociation,
  pollRcTerminalPairing,
  RcTerminalApiError,
  RcTerminalAssociation,
  RcTerminalPairing,
  resetRcTerminalAssociation,
  startRcTerminalPairing,
} from '../utils/rcTerminalAuth';

type DialogMode =
  | 'loading'
  | 'starting_pairing'
  | 'pairing'
  | 'pin'
  | 'authenticating'
  | 'error';

interface Props {
  visible: boolean;
  sessionErrorStatus?: number | null;
  onClose: () => void;
  onSessionTicket: (ticket: string) => Promise<void>;
  onAssociationChange?: (association: RcTerminalAssociation | null) => void;
}

const pairingErrorMessage = (error: unknown): string => {
  if (error instanceof RcTerminalApiError) {
    if (error.code === 'network_error') {
      return 'Relic Commander is unreachable. Check Wi-Fi and try again.';
    }
    if (error.code === 'rate_limited' || error.code === 'retry_later') {
      return 'Too many requests. Wait before starting a new association.';
    }
  }
  return 'The Terminal association could not be started.';
};

export default function RcTerminalLoginDialog({
  visible,
  sessionErrorStatus,
  onClose,
  onSessionTicket,
  onAssociationChange,
}: Props) {
  const { width, height } = useWindowDimensions();
  const isLandscape = width > height;
  const [mode, setMode] = useState<DialogMode>('loading');
  const [association, setAssociation] = useState<RcTerminalAssociation | null>(
    null,
  );
  const [pairing, setPairing] = useState<RcTerminalPairing | null>(null);
  const [pin, setPin] = useState('');
  const [message, setMessage] = useState('');
  const [countdownSeconds, setCountdownSeconds] = useState(0);
  const [retryUntil, setRetryUntil] = useState(0);
  const aliveRef = useRef(true);
  const pairingGenerationRef = useRef(0);

  const clearEphemeralState = useCallback(() => {
    pairingGenerationRef.current += 1;
    setPairing(null);
    setPin('');
    setRetryUntil(0);
    Keyboard.dismiss();
  }, []);

  const close = useCallback(() => {
    clearEphemeralState();
    onClose();
  }, [clearEphemeralState, onClose]);

  const beginPairing = useCallback(async (): Promise<void> => {
    const generation = pairingGenerationRef.current + 1;
    pairingGenerationRef.current = generation;
    setMode('starting_pairing');
    setMessage('Creating a secure Terminal identity…');
    setPin('');
    try {
      const request = await startRcTerminalPairing();
      if (!aliveRef.current || pairingGenerationRef.current !== generation) {
        return;
      }
      setPairing(request);
      setCountdownSeconds(
        Math.max(0, Math.ceil((request.expiresAt - Date.now()) / 1000)),
      );
      setMessage(
        'Scan the QR code, choose your PIN, then approve this Terminal.',
      );
      setMode('pairing');
    } catch (error) {
      if (!aliveRef.current || pairingGenerationRef.current !== generation) {
        return;
      }
      setPairing(null);
      setMessage(pairingErrorMessage(error));
      setMode('error');
    }
  }, []);

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      pairingGenerationRef.current += 1;
    };
  }, []);

  useEffect(() => {
    if (!visible) {
      clearEphemeralState();
      return;
    }

    let active = true;
    setMode('loading');
    setMessage('Checking Terminal identity…');
    loadRcTerminalAssociation()
      .then(storedAssociation => {
        if (!active) return;
        setAssociation(storedAssociation);
        onAssociationChange?.(storedAssociation);
        if (storedAssociation) {
          setMode('pin');
          setMessage(
            sessionErrorStatus
              ? 'The previous session ticket was refused. Enter your PIN to try again.'
              : 'Terminal identity verified. Enter your account PIN.',
          );
        } else {
          beginPairing();
        }
      })
      .catch(() => {
        if (!active) return;
        setAssociation(null);
        onAssociationChange?.(null);
        setMode('error');
        setMessage('The local Terminal identity could not be read.');
      });

    return () => {
      active = false;
    };
  }, [
    beginPairing,
    clearEphemeralState,
    onAssociationChange,
    sessionErrorStatus,
    visible,
  ]);

  useEffect(() => {
    if (!visible || mode !== 'pairing' || !pairing) return;
    const generation = pairingGenerationRef.current;
    let canceled = false;
    let pollTimer: ReturnType<typeof setTimeout> | null = null;

    const updateCountdown = () => {
      const remaining = Math.max(
        0,
        Math.ceil((pairing.expiresAt - Date.now()) / 1000),
      );
      setCountdownSeconds(remaining);
      if (remaining === 0) {
        canceled = true;
        setPairing(null);
        setMessage('This association request expired. Start a new one.');
        setMode('error');
      }
    };
    const countdownTimer = setInterval(updateCountdown, 1000);

    const poll = (delaySeconds: number): void => {
      pollTimer = setTimeout(async () => {
        if (canceled || pairingGenerationRef.current !== generation) return;
        try {
          const result = await pollRcTerminalPairing(pairing);
          if (canceled || pairingGenerationRef.current !== generation) return;
          if (result.status === 'pending') {
            poll(result.pollIntervalSeconds);
          } else if (result.status === 'approved') {
            pairingGenerationRef.current += 1;
            setPairing(null);
            setAssociation(result.association);
            onAssociationChange?.(result.association);
            setMessage('Association approved. Enter the PIN you just created.');
            setMode('pin');
          } else {
            pairingGenerationRef.current += 1;
            setPairing(null);
            setMessage(
              result.status === 'expired'
                ? 'This association request expired. Start a new one.'
                : 'This association request was canceled.',
            );
            setMode('error');
          }
        } catch (error) {
          if (canceled || pairingGenerationRef.current !== generation) return;
          if (
            error instanceof RcTerminalApiError &&
            error.code === 'pairing_not_found'
          ) {
            pairingGenerationRef.current += 1;
            setPairing(null);
            setMessage('This association request is no longer available.');
            setMode('error');
            return;
          }
          // A temporary network failure does not expose or discard the in-memory
          // pairing secret. Retry at the server-provided interval until expiry.
          poll(pairing.pollIntervalSeconds);
        }
      }, Math.max(1, delaySeconds) * 1000);
    };

    poll(pairing.pollIntervalSeconds);
    return () => {
      canceled = true;
      clearInterval(countdownTimer);
      if (pollTimer) clearTimeout(pollTimer);
    };
  }, [mode, onAssociationChange, pairing, visible]);

  useEffect(() => {
    if (!retryUntil) return;
    const timer = setInterval(() => {
      if (Date.now() >= retryUntil) setRetryUntil(0);
    }, 500);
    return () => clearInterval(timer);
  }, [retryUntil]);

  const submitPin = async (): Promise<void> => {
    if (!association || !/^\d{6,10}$/.test(pin) || retryUntil > Date.now()) {
      return;
    }
    const generation = pairingGenerationRef.current;
    const attemptPin = pin;
    setMode('authenticating');
    setMessage('Verifying Terminal identity…');
    try {
      const session = await authenticateRcTerminal(association, attemptPin);
      if (pairingGenerationRef.current !== generation) return;
      setPin('');
      try {
        await onSessionTicket(session.ticket);
      } catch {
        if (pairingGenerationRef.current !== generation) return;
        setMessage(
          'The secure session could not be opened. Enter your PIN to request a new session.',
        );
        setMode('pin');
        return;
      }
      if (pairingGenerationRef.current !== generation) return;
      setMessage('Access granted. Opening Relic Commander…');
      close();
    } catch (error) {
      if (pairingGenerationRef.current !== generation) return;
      setPin('');
      if (
        error instanceof RcTerminalApiError &&
        (error.code === 'association_unavailable' ||
          error.code === 'association_revoked')
      ) {
        await resetRcTerminalAssociation().catch(() => {});
        setAssociation(null);
        onAssociationChange?.(null);
        setMessage('This Terminal association was revoked. Pair it again.');
        setMode('error');
      } else if (
        error instanceof RcTerminalApiError &&
        error.code === 'invalid_credentials'
      ) {
        const retryAfter = error.retryAfter ?? 0;
        if (retryAfter > 0) setRetryUntil(Date.now() + retryAfter * 1000);
        const remaining =
          error.attemptsRemaining === null
            ? ''
            : ` ${error.attemptsRemaining} attempt(s) remaining.`;
        setMessage(`Incorrect PIN.${remaining}`);
        setMode('pin');
      } else if (
        error instanceof RcTerminalApiError &&
        (error.code === 'retry_later' || error.code === 'rate_limited')
      ) {
        const retryAfter = error.retryAfter ?? 1;
        setRetryUntil(Date.now() + retryAfter * 1000);
        setMessage('Authentication is temporarily limited. Please wait.');
        setMode('pin');
      } else if (
        error instanceof RcTerminalApiError &&
        (error.code === 'verification_failed' ||
          error.code === 'invalid_response')
      ) {
        setMessage(
          'Terminal identity verification failed. The PIN was not counted as incorrect.',
        );
        setMode('pin');
      } else {
        setMessage('Unable to sign in. Check Wi-Fi and try again.');
        setMode('pin');
      }
    } finally {
      setPin('');
    }
  };

  const confirmReset = (): void => {
    Alert.alert(
      'Reset Terminal association?',
      'The device identity will be deleted. A new QR code and account approval will be required.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reset',
          style: 'destructive',
          onPress: () => {
            clearEphemeralState();
            setMode('loading');
            setMessage('Resetting Terminal identity…');
            resetRcTerminalAssociation()
              .then(() => {
                setAssociation(null);
                onAssociationChange?.(null);
                beginPairing();
              })
              .catch(() => {
                setMode('error');
                setMessage('The Terminal identity could not be reset.');
              });
          },
        },
      ],
    );
  };

  const retrySeconds = Math.max(0, Math.ceil((retryUntil - Date.now()) / 1000));
  const isBusy = mode === 'loading' || mode === 'starting_pairing';

  return (
    <Modal
      visible={visible}
      transparent
      statusBarTranslucent
      animationType="fade"
      onRequestClose={close}
    >
      <View style={styles.overlay}>
        <View style={[styles.card, isLandscape && styles.cardLandscape]}>
          <View style={styles.header}>
            <View style={styles.headerText}>
              <Text style={styles.eyebrow}>RELIC COMMANDER TERMINAL</Text>
              <Text style={styles.title}>Terminal Access</Text>
              <Text style={styles.subtitle}>SECURE QUICK LOGIN</Text>
            </View>
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel="Close Terminal login"
              style={styles.closeButton}
              hitSlop={{ top: 8, right: 8, bottom: 8, left: 8 }}
              onPress={close}
            >
              <MaterialCommunityIcons
                name="close"
                size={22}
                color={RC_THEME.colors.textSecondary}
              />
            </TouchableOpacity>
          </View>

          <ScrollView
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.body}
          >
            {isBusy && (
              <View style={styles.centeredBlock}>
                <ActivityIndicator
                  size="large"
                  color={RC_THEME.colors.accentBright}
                />
                <Text style={styles.message}>{message}</Text>
              </View>
            )}

            {mode === 'pairing' && pairing && (
              <View
                style={[
                  styles.pairingLayout,
                  isLandscape && styles.pairingLayoutLandscape,
                ]}
              >
                <View style={styles.qrFrame}>
                  <QRCode
                    value={pairing.verificationUriComplete}
                    size={isLandscape ? 190 : Math.min(width - 110, 210)}
                    color="#07111D"
                    backgroundColor="#FFFFFF"
                  />
                </View>
                <View style={styles.pairingInstructions}>
                  <MaterialCommunityIcons
                    name="cellphone-key"
                    size={34}
                    color={RC_THEME.colors.accentBright}
                  />
                  <Text style={styles.sectionTitle}>Pair this Terminal</Text>
                  <Text style={styles.message}>{message}</Text>
                  <Text style={styles.codeLabel}>VERIFICATION CODE</Text>
                  <Text selectable style={styles.userCode}>
                    {pairing.userCode}
                  </Text>
                  <Text style={styles.countdown}>
                    Expires in {countdownSeconds}s
                  </Text>
                </View>
              </View>
            )}

            {(mode === 'pin' || mode === 'authenticating') && association && (
              <View style={styles.pinLayout}>
                <View style={styles.identityBadge}>
                  <MaterialCommunityIcons
                    name="shield-check-outline"
                    size={36}
                    color={RC_THEME.colors.success}
                  />
                  <View>
                    <Text style={styles.identityLabel}>
                      TERMINAL IDENTITY VERIFIED
                    </Text>
                    <Text style={styles.terminalId}>
                      {association.terminalId}
                    </Text>
                  </View>
                </View>
                <Text style={styles.message}>{message}</Text>
                <TextInput
                  accessibilityLabel="Relic Commander account PIN"
                  value={pin}
                  editable={mode === 'pin' && retrySeconds === 0}
                  autoFocus={mode === 'pin'}
                  keyboardType="number-pad"
                  secureTextEntry
                  maxLength={10}
                  autoCorrect={false}
                  autoComplete="off"
                  importantForAutofill="no"
                  placeholder="6–10 digit PIN"
                  placeholderTextColor={RC_THEME.colors.textMuted}
                  style={styles.pinInput}
                  onChangeText={value => setPin(value.replace(/\D/g, ''))}
                  onSubmitEditing={submitPin}
                />
                {retrySeconds > 0 && (
                  <Text style={styles.retryText}>
                    Try again in {retrySeconds}s
                  </Text>
                )}
                <TouchableOpacity
                  accessibilityRole="button"
                  accessibilityLabel="Access Relic Commander"
                  disabled={
                    mode !== 'pin' ||
                    !/^\d{6,10}$/.test(pin) ||
                    retrySeconds > 0
                  }
                  activeOpacity={0.75}
                  style={[
                    styles.primaryButton,
                    (mode !== 'pin' ||
                      !/^\d{6,10}$/.test(pin) ||
                      retrySeconds > 0) &&
                      styles.buttonDisabled,
                  ]}
                  onPress={submitPin}
                >
                  {mode === 'authenticating' ? (
                    <ActivityIndicator
                      size="small"
                      color={RC_THEME.colors.textInverse}
                    />
                  ) : (
                    <MaterialCommunityIcons
                      name="login-variant"
                      size={21}
                      color={RC_THEME.colors.textInverse}
                    />
                  )}
                  <Text style={styles.primaryButtonText}>Access your game</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  accessibilityRole="button"
                  style={styles.linkButton}
                  onPress={confirmReset}
                >
                  <Text style={styles.linkButtonText}>
                    Forgot PIN or reset association
                  </Text>
                </TouchableOpacity>
              </View>
            )}

            {mode === 'error' && (
              <View style={styles.centeredBlock}>
                <MaterialCommunityIcons
                  name="alert-circle-outline"
                  size={42}
                  color={RC_THEME.colors.warning}
                />
                <Text style={styles.message}>{message}</Text>
                <TouchableOpacity
                  accessibilityRole="button"
                  style={styles.primaryButton}
                  onPress={beginPairing}
                >
                  <MaterialCommunityIcons
                    name="qrcode-scan"
                    size={21}
                    color={RC_THEME.colors.textInverse}
                  />
                  <Text style={styles.primaryButtonText}>
                    Try pairing again
                  </Text>
                </TouchableOpacity>
              </View>
            )}

            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel="Browse the public Relic Commander site"
              style={styles.browseButton}
              onPress={close}
            >
              <MaterialCommunityIcons
                name="web"
                size={20}
                color={RC_THEME.colors.accentBright}
              />
              <Text style={styles.browseButtonText}>
                Browse Relic Commander
              </Text>
            </TouchableOpacity>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
    backgroundColor: RC_THEME.colors.overlay,
  },
  card: {
    width: '100%',
    maxWidth: 620,
    maxHeight: '92%',
    padding: 20,
    borderWidth: 1,
    borderColor: RC_THEME.colors.borderStrong,
    borderRadius: RC_THEME.radius.large,
    backgroundColor: RC_THEME.colors.surfaceCard,
    ...RC_THEME.shadow.card,
  },
  cardLandscape: {
    maxWidth: 760,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    paddingBottom: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: RC_THEME.colors.border,
  },
  headerText: { flex: 1, paddingRight: 12 },
  eyebrow: {
    color: RC_THEME.colors.primary,
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1.7,
  },
  title: {
    marginTop: 4,
    color: RC_THEME.colors.textPrimary,
    fontSize: 25,
    fontWeight: '800',
    letterSpacing: 1.1,
    textTransform: 'uppercase',
  },
  subtitle: {
    marginTop: 3,
    color: RC_THEME.colors.textMuted,
    fontSize: 10,
    letterSpacing: 1.4,
  },
  closeButton: {
    width: 38,
    height: 38,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: RC_THEME.colors.border,
    borderRadius: RC_THEME.radius.pill,
    backgroundColor: RC_THEME.colors.surfaceInput,
  },
  body: { paddingTop: 18 },
  centeredBlock: { alignItems: 'center', paddingVertical: 22 },
  pairingLayout: { alignItems: 'center' },
  pairingLayoutLandscape: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 28,
  },
  qrFrame: {
    padding: 12,
    borderRadius: RC_THEME.radius.medium,
    backgroundColor: '#FFFFFF',
  },
  pairingInstructions: {
    flexShrink: 1,
    alignItems: 'center',
    marginTop: 16,
  },
  sectionTitle: {
    marginTop: 8,
    color: RC_THEME.colors.textPrimary,
    fontSize: 18,
    fontWeight: '800',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  message: {
    marginTop: 12,
    color: RC_THEME.colors.textSecondary,
    fontSize: 13,
    lineHeight: 19,
    textAlign: 'center',
  },
  codeLabel: {
    marginTop: 17,
    color: RC_THEME.colors.textMuted,
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 1.3,
  },
  userCode: {
    marginTop: 4,
    color: RC_THEME.colors.accentBright,
    fontSize: 25,
    fontWeight: '900',
    letterSpacing: 3,
  },
  countdown: {
    marginTop: 6,
    color: RC_THEME.colors.textMuted,
    fontSize: 11,
  },
  pinLayout: { alignItems: 'stretch', paddingHorizontal: 8 },
  identityBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 11,
    borderWidth: 1,
    borderColor: RC_THEME.colors.borderStrong,
    borderRadius: RC_THEME.radius.medium,
    backgroundColor: RC_THEME.colors.surfaceCardDeep,
  },
  identityLabel: {
    color: RC_THEME.colors.success,
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 1.1,
  },
  terminalId: {
    marginTop: 3,
    color: RC_THEME.colors.textPrimary,
    fontSize: 17,
    fontWeight: '800',
    letterSpacing: 1.3,
  },
  pinInput: {
    height: 58,
    marginTop: 18,
    paddingHorizontal: 18,
    borderWidth: 1,
    borderColor: RC_THEME.colors.primary,
    borderRadius: RC_THEME.radius.medium,
    backgroundColor: RC_THEME.colors.surfaceInput,
    color: RC_THEME.colors.textPrimary,
    fontSize: 24,
    fontWeight: '700',
    letterSpacing: 6,
    textAlign: 'center',
  },
  retryText: {
    marginTop: 8,
    color: RC_THEME.colors.warning,
    fontSize: 12,
    textAlign: 'center',
  },
  primaryButton: {
    minHeight: 50,
    marginTop: 16,
    paddingHorizontal: 18,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 9,
    borderRadius: RC_THEME.radius.medium,
    backgroundColor: RC_THEME.colors.primary,
  },
  primaryButtonText: {
    color: RC_THEME.colors.textInverse,
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 0.7,
    textTransform: 'uppercase',
  },
  buttonDisabled: { opacity: 0.45 },
  linkButton: { alignItems: 'center', paddingVertical: 13 },
  linkButtonText: {
    color: RC_THEME.colors.textMuted,
    fontSize: 11,
    textDecorationLine: 'underline',
  },
  browseButton: {
    minHeight: 46,
    marginTop: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderWidth: 1,
    borderColor: RC_THEME.colors.borderStrong,
    borderRadius: RC_THEME.radius.medium,
    backgroundColor: RC_THEME.colors.surfaceCardDeep,
  },
  browseButtonText: {
    color: RC_THEME.colors.textSection,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
});
