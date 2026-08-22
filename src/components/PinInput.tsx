import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ActivityIndicator,
  NativeModules,
  ScrollView,
} from 'react-native';
import {
  verifySecurePin,
  getLockoutStatus,
  hasSecurePin,
} from '../utils/secureStorage';
import { StorageService } from '../utils/storage';
import WifiDialog from './WifiDialog';
import BluetoothDialog from './BluetoothDialog';
import AudioOutputDialog from './AudioOutputDialog';
import BrightnessDialog from './BrightnessDialog';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import { RC_THEME } from '../theme/relicCommanderTheme';

const {
  KioskModule,
  AudioControlModule,
  FlashlightModule,
  RotationControlModule,
} = NativeModules;

interface PinInputProps {
  onSuccess: () => void;
  storedPin: string; // Kept for backward compatibility but not used
}

const PinInput: React.FC<PinInputProps> = ({ onSuccess }) => {
  const [pin, setPin] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isLockedOut, setIsLockedOut] = useState<boolean>(false);
  const [lockoutTimeRemaining, setLockoutTimeRemaining] = useState<number>(0);
  const [attemptsRemaining, setAttemptsRemaining] = useState<number>(5);
  const [hasPinConfigured, setHasPinConfigured] = useState<boolean>(false);
  const [pinMode, setPinMode] = useState<'numeric' | 'alphanumeric'>('numeric');
  const inputRef = useRef<TextInput>(null);
  const [showWifiButton, setShowWifiButton] = useState(false);
  const [showBluetoothButton, setShowBluetoothButton] = useState(false);
  const [showAudioControls, setShowAudioControls] = useState(false);
  const [showEmergencyButton, setShowEmergencyButton] = useState(false);
  const [showFlashlightButton, setShowFlashlightButton] = useState(false);
  const [showBrightnessButton, setShowBrightnessButton] = useState(false);
  const [showRotationLockButton, setShowRotationLockButton] = useState(false);
  const [wifiDialogVisible, setWifiDialogVisible] = useState(false);
  const [bluetoothDialogVisible, setBluetoothDialogVisible] = useState(false);
  const [audioDialogVisible, setAudioDialogVisible] = useState(false);
  const [brightnessDialogVisible, setBrightnessDialogVisible] = useState(false);
  const [flashlightAvailable, setFlashlightAvailable] = useState(false);
  const [flashlightOn, setFlashlightOn] = useState(false);
  const [flashlightBusy, setFlashlightBusy] = useState(false);
  const [rotationLockAvailable, setRotationLockAvailable] = useState(false);
  const [rotationLocked, setRotationLocked] = useState(false);
  const [rotationBusy, setRotationBusy] = useState(false);

  useEffect(() => {
    checkLockoutStatus();
    checkPinConfiguration();
    loadPinMode();
    loadLockscreenSettings();
    const interval = setInterval(checkLockoutStatus, 1000);
    return () => {
      clearInterval(interval);
    };
  }, []);

  const loadLockscreenSettings = async (): Promise<void> => {
    const [
      controlsEnabled,
      wifi,
      bluetooth,
      audio,
      emergency,
      flashlight,
      brightness,
      rotationLock,
    ] = await Promise.all([
      StorageService.getLockscreenControlsEnabled(),
      StorageService.getLockscreenWifiEnabled(),
      StorageService.getLockscreenBluetoothEnabled(),
      StorageService.getLockscreenAudioEnabled(),
      StorageService.getLockscreenEmergencyCallEnabled(),
      StorageService.getLockscreenFlashlightEnabled(),
      StorageService.getLockscreenBrightnessEnabled(),
      StorageService.getLockscreenRotationLockEnabled(),
    ]);

    setShowWifiButton(controlsEnabled && wifi);
    setShowBluetoothButton(controlsEnabled && bluetooth);
    setShowAudioControls(controlsEnabled && audio);
    setShowEmergencyButton(controlsEnabled && emergency);
    setShowFlashlightButton(controlsEnabled && flashlight);
    setShowBrightnessButton(controlsEnabled && brightness);
    setShowRotationLockButton(controlsEnabled && rotationLock);

    if (controlsEnabled && flashlight && FlashlightModule?.isAvailable) {
      try {
        const available = await FlashlightModule.isAvailable();
        setFlashlightAvailable(Boolean(available));
        if (available && FlashlightModule?.getState) {
          const enabled = await FlashlightModule.getState();
          setFlashlightOn(Boolean(enabled));
        }
      } catch (e) {
        console.warn('[PinInput] flashlight availability error:', e);
        setFlashlightAvailable(false);
      }
    }

    if (controlsEnabled && rotationLock && RotationControlModule?.isAvailable) {
      try {
        const available = await RotationControlModule.isAvailable();
        setRotationLockAvailable(Boolean(available));
        if (available && RotationControlModule?.getState) {
          const state = await RotationControlModule.getState();
          setRotationLocked(Boolean(state?.locked));
        }
      } catch (e) {
        console.warn('[PinInput] rotation availability error:', e);
        setRotationLockAvailable(false);
      }
    }
  };

  const handlePinChange = (text: string): void => {
    if (pinMode === 'numeric') {
      const filtered = text.replace(/[^0-9]/g, '');
      setPin(filtered);
    } else {
      setPin(text);
    }
  };

  const loadPinMode = async (): Promise<void> => {
    const mode = await StorageService.getPinMode();
    setPinMode(mode);
  };

  const checkPinConfiguration = async (): Promise<void> => {
    const isPinConfigured = await hasSecurePin();
    setHasPinConfigured(isPinConfigured);
  };

  const checkLockoutStatus = async (): Promise<void> => {
    const status = await getLockoutStatus();
    setIsLockedOut(status.isLockedOut);
    setLockoutTimeRemaining(status.timeRemaining || 0);
    setAttemptsRemaining(status.attemptsRemaining);
  };

  const handleSubmit = async (): Promise<void> => {
    if (isLockedOut) {
      Alert.alert(
        '🔒 Locked Out',
        `Too many failed attempts.\n\nTry again in ${Math.ceil(
          lockoutTimeRemaining / 60000,
        )} minutes.`,
      );
      return;
    }

    if (pin.length < 4) {
      Alert.alert('Error', 'Password must be at least 4 characters');
      return;
    }

    setIsLoading(true);

    try {
      const result = await verifySecurePin(pin);

      if (result.success) {
        setPin('');
        onSuccess();
      } else {
        setPin('');

        if (result.lockoutTimeRemaining) {
          setIsLockedOut(true);
          setLockoutTimeRemaining(result.lockoutTimeRemaining);
          Alert.alert(
            '🔒 Too Many Failed Attempts',
            result.message || 'Account locked for 15 minutes',
            [{ text: 'OK' }],
          );
        } else {
          setAttemptsRemaining(result.attemptsRemaining || 0);
          Alert.alert(
            '❌ Incorrect PIN',
            `${result.attemptsRemaining || 0} attempts remaining`,
            [{ text: 'Try Again' }],
          );
        }
      }
    } catch (error) {
      console.error('[PinInput] Error verifying PIN:', error);
      Alert.alert('Error', 'An error occurred. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleEmergencyCall = async (): Promise<void> => {
    try {
      await KioskModule.launchEmergencyDial();
    } catch (e) {
      console.warn('[PinInput] launchEmergencyDial error:', e);
      Alert.alert('Emergency Call', 'Unable to open the emergency dialer.');
    }
  };

  const handleAudioPress = async (): Promise<void> => {
    try {
      if (AudioControlModule?.showSystemOutputSwitcher) {
        const shown = await AudioControlModule.showSystemOutputSwitcher();
        if (shown) {
          return;
        }
      }
    } catch (e) {
      console.warn('[PinInput] showSystemOutputSwitcher error:', e);
    }

    setAudioDialogVisible(true);
  };

  const handleFlashlightPress = async (): Promise<void> => {
    if (!FlashlightModule?.setEnabled || flashlightBusy) {
      return;
    }

    const next = !flashlightOn;
    setFlashlightBusy(true);
    setFlashlightOn(next);
    try {
      const result = await FlashlightModule.setEnabled(next);
      setFlashlightOn(Boolean(result));
    } catch (e) {
      console.warn('[PinInput] flashlight toggle error:', e);
      setFlashlightOn(!next);
      Alert.alert('Flashlight', 'Unable to change flashlight state.');
    } finally {
      setFlashlightBusy(false);
    }
  };

  const handleRotationLockPress = async (): Promise<void> => {
    if (rotationBusy) {
      return;
    }

    if (!rotationLockAvailable || !RotationControlModule?.setLocked) {
      Alert.alert(
        'Rotation lock',
        'Rotation lock is not available on this device right now.',
      );
      return;
    }

    const next = !rotationLocked;
    setRotationBusy(true);
    setRotationLocked(next);
    try {
      const state = await RotationControlModule.setLocked(next);
      setRotationLocked(Boolean(state?.locked));
    } catch (e) {
      console.warn('[PinInput] rotation toggle error:', e);
      setRotationLocked(!next);
      Alert.alert('Rotation lock', 'Unable to change rotation lock state.');
    } finally {
      setRotationBusy(false);
    }
  };

  const formatTime = (milliseconds: number): string => {
    const minutes = Math.floor(milliseconds / 60000);
    const seconds = Math.floor((milliseconds % 60000) / 1000);
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  };

  const hasQuickControls =
    showWifiButton ||
    showBluetoothButton ||
    showAudioControls ||
    showEmergencyButton ||
    (showFlashlightButton && flashlightAvailable) ||
    showBrightnessButton ||
    showRotationLockButton;

  return (
    <ScrollView
      style={styles.scrollView}
      contentContainerStyle={styles.container}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.brandHeader}>
        <Text style={styles.eyebrow}>RELIC COMMANDER TERMINAL</Text>
        <Text style={styles.brandTitle}>Admin authorization</Text>
        <Text style={styles.brandSubtitle}>RESTRICTED DEVICE CONTROL</Text>
      </View>

      <View style={styles.authCard}>
        <View style={styles.lockIconShell}>
          <MaterialCommunityIcons
            name="shield-lock-outline"
            size={34}
            color={RC_THEME.colors.accentBright}
          />
        </View>
        <Text style={styles.title}>
          {pinMode === 'alphanumeric' ? 'Enter password' : 'Enter PIN code'}
        </Text>

        {isLockedOut ? (
          <>
            <View style={styles.lockoutContainer}>
              <MaterialCommunityIcons
                name="lock-alert"
                size={46}
                color={RC_THEME.colors.danger}
                style={styles.lockoutIcon}
              />
              <Text style={styles.lockoutTitle}>Account Locked</Text>
              <Text style={styles.lockoutText}>Too many failed attempts</Text>
              <Text style={styles.lockoutTimer}>
                Retry in: {formatTime(lockoutTimeRemaining)}
              </Text>
            </View>
          </>
        ) : (
          <>
            {!hasPinConfigured && (
              <Text style={styles.subtitle}>Default code: 1234</Text>
            )}

            {attemptsRemaining < 5 && (
              <View style={styles.warningContainer}>
                <Text style={styles.warningText}>
                  ⚠️ {attemptsRemaining} attempts remaining
                </Text>
              </View>
            )}

            <TextInput
              ref={inputRef}
              style={[styles.input, isLoading && styles.inputDisabled]}
              value={pin}
              onChangeText={handlePinChange}
              secureTextEntry={true}
              keyboardType={pinMode === 'alphanumeric' ? 'default' : 'numeric'}
              maxLength={pinMode === 'alphanumeric' ? undefined : 6}
              placeholder={
                pinMode === 'alphanumeric' ? 'Enter password' : '••••'
              }
              placeholderTextColor={RC_THEME.colors.textMuted}
              autoCapitalize={pinMode === 'alphanumeric' ? 'none' : undefined}
              autoCorrect={false}
              autoComplete="off"
              textContentType="none"
              importantForAutofill="no"
              editable={!isLoading && !isLockedOut}
            />

            <TouchableOpacity
              style={[
                styles.button,
                (isLoading || isLockedOut) && styles.buttonDisabled,
              ]}
              onPress={handleSubmit}
              disabled={isLoading || isLockedOut}
            >
              {isLoading ? (
                <ActivityIndicator color={RC_THEME.colors.textInverse} />
              ) : (
                <Text style={styles.buttonText}>Unlock settings</Text>
              )}
            </TouchableOpacity>
          </>
        )}
      </View>

      {hasQuickControls && (
        <View style={styles.quickControls}>
          {showWifiButton && (
            <TouchableOpacity
              style={styles.quickBtn}
              onPress={() => setWifiDialogVisible(true)}
            >
              <MaterialCommunityIcons
                name="wifi"
                size={27}
                color={RC_THEME.colors.accentBright}
              />
              <Text style={styles.quickBtnLabel}>Wi-Fi</Text>
            </TouchableOpacity>
          )}

          {showBluetoothButton && (
            <TouchableOpacity
              style={styles.quickBtn}
              onPress={() => setBluetoothDialogVisible(true)}
            >
              <MaterialCommunityIcons
                name="bluetooth"
                size={27}
                color={RC_THEME.colors.accentBright}
              />
              <Text style={styles.quickBtnLabel}>Bluetooth</Text>
            </TouchableOpacity>
          )}

          {showAudioControls && (
            <TouchableOpacity
              style={styles.quickBtn}
              onPress={handleAudioPress}
            >
              <MaterialCommunityIcons
                name="volume-high"
                size={27}
                color={RC_THEME.colors.accentBright}
              />
              <Text style={styles.quickBtnLabel}>Audio</Text>
            </TouchableOpacity>
          )}

          {showFlashlightButton && flashlightAvailable && (
            <TouchableOpacity
              style={[styles.quickBtn, flashlightOn && styles.quickBtnActive]}
              onPress={handleFlashlightPress}
              disabled={flashlightBusy}
            >
              <MaterialCommunityIcons
                name={flashlightOn ? 'flashlight-off' : 'flashlight'}
                size={27}
                color={
                  flashlightOn
                    ? RC_THEME.colors.warning
                    : RC_THEME.colors.accentBright
                }
              />
              <Text style={styles.quickBtnLabel}>
                {flashlightOn ? 'Light Off' : 'Light On'}
              </Text>
            </TouchableOpacity>
          )}

          {showBrightnessButton && (
            <TouchableOpacity
              style={styles.quickBtn}
              onPress={() => setBrightnessDialogVisible(true)}
            >
              <MaterialCommunityIcons
                name="brightness-6"
                size={27}
                color={RC_THEME.colors.accentBright}
              />
              <Text style={styles.quickBtnLabel}>Brightness</Text>
            </TouchableOpacity>
          )}

          {showRotationLockButton && (
            <TouchableOpacity
              style={[styles.quickBtn, rotationLocked && styles.quickBtnActive]}
              onPress={handleRotationLockPress}
              disabled={rotationBusy}
            >
              <MaterialCommunityIcons
                name={
                  rotationLocked ? 'screen-rotation-lock' : 'screen-rotation'
                }
                size={27}
                color={
                  rotationLocked
                    ? RC_THEME.colors.warning
                    : RC_THEME.colors.accentBright
                }
              />
              <Text style={styles.quickBtnLabel}>Rotate</Text>
            </TouchableOpacity>
          )}

          {showEmergencyButton && (
            <TouchableOpacity
              style={[styles.quickBtn, styles.emergencyBtn]}
              onPress={handleEmergencyCall}
            >
              <MaterialCommunityIcons
                name="phone-alert"
                size={27}
                color={RC_THEME.colors.danger}
              />
              <Text style={[styles.quickBtnLabel, styles.emergencyLabel]}>
                Emergency
              </Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      <WifiDialog
        visible={wifiDialogVisible}
        onClose={() => setWifiDialogVisible(false)}
      />
      <BluetoothDialog
        visible={bluetoothDialogVisible}
        onClose={() => setBluetoothDialogVisible(false)}
      />
      <AudioOutputDialog
        visible={audioDialogVisible}
        onClose={() => setAudioDialogVisible(false)}
      />
      <BrightnessDialog
        visible={brightnessDialogVisible}
        onClose={() => setBrightnessDialogVisible(false)}
      />
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  scrollView: {
    flex: 1,
    backgroundColor: RC_THEME.colors.background,
  },
  container: {
    flexGrow: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: RC_THEME.colors.background,
    paddingHorizontal: 20,
    paddingTop: 82,
    paddingBottom: 24,
  },
  brandHeader: {
    alignItems: 'center',
    marginBottom: 18,
  },
  eyebrow: {
    color: RC_THEME.colors.primary,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 2,
  },
  brandTitle: {
    marginTop: 5,
    color: RC_THEME.colors.textPrimary,
    fontSize: 23,
    fontWeight: '700',
    letterSpacing: 1.3,
    textAlign: 'center',
    textTransform: 'uppercase',
  },
  brandSubtitle: {
    marginTop: 5,
    color: RC_THEME.colors.textMuted,
    fontSize: 10,
    letterSpacing: 1.4,
  },
  authCard: {
    width: '100%',
    maxWidth: 420,
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingVertical: 24,
    borderWidth: 1,
    borderColor: RC_THEME.colors.borderStrong,
    borderRadius: RC_THEME.radius.large,
    backgroundColor: RC_THEME.colors.surfaceCard,
    ...RC_THEME.shadow.card,
  },
  lockIconShell: {
    width: 58,
    height: 58,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
    borderWidth: 1,
    borderColor: RC_THEME.colors.primary,
    borderRadius: RC_THEME.radius.pill,
    backgroundColor: RC_THEME.colors.surfaceAccent,
    ...RC_THEME.shadow.glow,
  },
  title: {
    marginBottom: 14,
    color: RC_THEME.colors.textSection,
    fontSize: 18,
    fontWeight: '700',
    letterSpacing: 1,
    textAlign: 'center',
    textTransform: 'uppercase',
  },
  subtitle: {
    marginBottom: 18,
    color: RC_THEME.colors.warning,
    fontSize: 14,
  },
  input: {
    width: '100%',
    height: 60,
    marginBottom: 18,
    paddingHorizontal: 20,
    borderWidth: 1,
    borderColor: RC_THEME.colors.primary,
    borderRadius: RC_THEME.radius.medium,
    backgroundColor: RC_THEME.colors.surfaceInput,
    color: RC_THEME.colors.textPrimary,
    fontSize: 24,
    letterSpacing: 10,
    textAlign: 'center',
  },
  inputDisabled: {
    borderColor: RC_THEME.colors.disabled,
    backgroundColor: RC_THEME.colors.surfaceElevated,
    opacity: 0.6,
  },
  button: {
    minWidth: 220,
    alignItems: 'center',
    paddingHorizontal: 50,
    paddingVertical: 15,
    borderWidth: 1,
    borderColor: RC_THEME.colors.primary,
    borderRadius: RC_THEME.radius.small,
    backgroundColor: RC_THEME.colors.primaryPressed,
    ...RC_THEME.shadow.glow,
  },
  buttonDisabled: {
    borderColor: RC_THEME.colors.disabled,
    backgroundColor: RC_THEME.colors.surfaceElevated,
    opacity: 0.6,
  },
  buttonText: {
    color: RC_THEME.colors.textInverse,
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  warningContainer: {
    width: '100%',
    marginBottom: 18,
    padding: 12,
    borderWidth: 1,
    borderColor: RC_THEME.colors.warning,
    borderRadius: RC_THEME.radius.medium,
    backgroundColor: RC_THEME.colors.surfaceAccent,
  },
  warningText: {
    color: RC_THEME.colors.warning,
    fontSize: 14,
    fontWeight: '700',
    textAlign: 'center',
  },
  lockoutContainer: {
    width: '100%',
    alignItems: 'center',
    padding: 24,
    borderWidth: 1,
    borderColor: RC_THEME.colors.danger,
    borderRadius: RC_THEME.radius.medium,
    backgroundColor: RC_THEME.colors.dangerBackground,
  },
  lockoutIcon: {
    marginBottom: 12,
  },
  lockoutTitle: {
    marginBottom: 8,
    color: RC_THEME.colors.danger,
    fontSize: 22,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  lockoutText: {
    marginBottom: 16,
    color: RC_THEME.colors.textSecondary,
    fontSize: 16,
    textAlign: 'center',
  },
  lockoutTimer: {
    color: RC_THEME.colors.danger,
    fontSize: 32,
    fontWeight: '700',
    fontFamily: 'monospace',
  },
  quickControls: {
    width: '100%',
    maxWidth: 320,
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    rowGap: 10,
    marginTop: 18,
  },
  quickBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    paddingHorizontal: 8,
    width: '31%',
    minHeight: 72,
    borderWidth: 1,
    borderColor: RC_THEME.colors.border,
    borderRadius: RC_THEME.radius.medium,
    backgroundColor: RC_THEME.colors.surface,
  },
  quickBtnActive: {
    borderColor: RC_THEME.colors.warning,
    backgroundColor: RC_THEME.colors.surfaceAccent,
  },
  quickBtnLabel: {
    marginTop: 5,
    color: RC_THEME.colors.textSection,
    fontSize: 11,
    fontWeight: '700',
    textAlign: 'center',
    textTransform: 'uppercase',
  },
  emergencyBtn: {
    borderColor: RC_THEME.colors.danger,
  },
  emergencyLabel: {
    color: RC_THEME.colors.danger,
  },
});

export default PinInput;
