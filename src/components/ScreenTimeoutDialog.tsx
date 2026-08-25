import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import ScreenTimeoutModule from '../utils/ScreenTimeoutModule';
import { RC_THEME } from '../theme/relicCommanderTheme';

interface Props {
  visible: boolean;
  onClose: () => void;
}

const TIMEOUT_PRESETS = [
  { label: '30 sec', value: 30_000 },
  { label: '1 min', value: 60_000 },
  { label: '2 min', value: 120_000 },
  { label: '5 min', value: 300_000 },
  { label: '10 min', value: 600_000 },
] as const;

function timeoutLabel(timeoutMs: number | null): string {
  const preset = TIMEOUT_PRESETS.find(option => option.value === timeoutMs);
  return preset?.label ?? 'System default';
}

export default function ScreenTimeoutDialog({ visible, onClose }: Props) {
  const [timeoutMs, setTimeoutMs] = useState<number | null>(null);
  const [available, setAvailable] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(
    'Choose when the inactive screen turns off.',
  );

  useEffect(() => {
    if (!visible) return;
    let active = true;

    (async () => {
      try {
        const canChange = await ScreenTimeoutModule.isAvailable();
        const current = await ScreenTimeoutModule.getTimeout();
        if (!active) return;
        setAvailable(canChange);
        setTimeoutMs(Math.round(current));
        setMessage(
          canChange
            ? 'Choose when the inactive screen turns off.'
            : 'Android does not allow this terminal to change the sleep timer.',
        );
      } catch (error) {
        console.warn('[ScreenTimeoutDialog] load error:', error);
        if (active) {
          setAvailable(false);
          setMessage('The sleep timer is unavailable on this device.');
        }
      }
    })();

    return () => {
      active = false;
    };
  }, [visible]);

  const applyTimeout = async (nextTimeoutMs: number): Promise<void> => {
    if (!available || busy) return;
    setBusy(true);
    try {
      const applied = await ScreenTimeoutModule.setTimeout(nextTimeoutMs);
      setTimeoutMs(Math.round(applied));
      setMessage(`Screen sleep set to ${timeoutLabel(Math.round(applied))}.`);
    } catch (error) {
      console.warn('[ScreenTimeoutDialog] set timeout error:', error);
      setMessage('Android refused to change the sleep timer.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      visible={visible}
      transparent
      statusBarTranslucent
      animationType="fade"
      onRequestClose={onClose}
    >
      <TouchableOpacity
        style={styles.overlay}
        activeOpacity={1}
        onPress={onClose}
      >
        <TouchableOpacity style={styles.card} activeOpacity={1}>
          <View style={styles.header}>
            <View style={styles.headerText}>
              <Text style={styles.eyebrow}>RELIC COMMANDER TERMINAL</Text>
              <Text style={styles.title}>Screen sleep</Text>
            </View>
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel="Close screen sleep controls"
              style={styles.closeButton}
              onPress={onClose}
            >
              <MaterialCommunityIcons
                name="close"
                size={22}
                color={RC_THEME.colors.textSecondary}
              />
            </TouchableOpacity>
          </View>

          <View style={styles.currentValueRow}>
            <MaterialCommunityIcons
              name="power-sleep"
              size={28}
              color={RC_THEME.colors.accentBright}
            />
            <Text style={styles.currentValue}>{timeoutLabel(timeoutMs)}</Text>
            {busy && (
              <ActivityIndicator
                size="small"
                color={RC_THEME.colors.accentBright}
              />
            )}
          </View>

          <Text style={[styles.message, !available && styles.messageWarning]}>
            {message}
          </Text>

          <View style={styles.presets}>
            {TIMEOUT_PRESETS.map(preset => {
              const selected = timeoutMs === preset.value;
              return (
                <TouchableOpacity
                  key={preset.value}
                  accessibilityRole="button"
                  accessibilityLabel={`Set screen sleep to ${preset.label}`}
                  disabled={!available || busy}
                  activeOpacity={0.75}
                  style={[
                    styles.presetButton,
                    selected && styles.presetButtonActive,
                    (!available || busy) && styles.presetButtonDisabled,
                  ]}
                  onPress={async () => {
                    await applyTimeout(preset.value);
                  }}
                >
                  <Text
                    style={[
                      styles.presetText,
                      selected && styles.presetTextActive,
                    ]}
                  >
                    {preset.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <Text style={styles.hint}>
            The timer resets whenever the player touches the screen.
          </Text>
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    backgroundColor: RC_THEME.colors.overlay,
  },
  card: {
    width: '100%',
    maxWidth: 520,
    padding: 20,
    borderWidth: 1,
    borderColor: RC_THEME.colors.borderStrong,
    borderRadius: RC_THEME.radius.large,
    backgroundColor: RC_THEME.colors.surfaceCard,
    ...RC_THEME.shadow.card,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  headerText: {
    flex: 1,
  },
  eyebrow: {
    marginBottom: 3,
    color: RC_THEME.colors.primary,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.8,
  },
  title: {
    color: RC_THEME.colors.textPrimary,
    fontSize: 18,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  closeButton: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: RC_THEME.colors.border,
    borderRadius: RC_THEME.radius.pill,
    backgroundColor: RC_THEME.colors.surfaceInput,
  },
  currentValueRow: {
    minHeight: 54,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    borderWidth: 1,
    borderColor: RC_THEME.colors.border,
    borderRadius: RC_THEME.radius.medium,
    backgroundColor: RC_THEME.colors.surfaceCardDeep,
  },
  currentValue: {
    color: RC_THEME.colors.accentBright,
    fontSize: 24,
    fontWeight: '700',
  },
  message: {
    minHeight: 34,
    marginTop: 10,
    color: RC_THEME.colors.textSecondary,
    fontSize: 12,
    lineHeight: 17,
    textAlign: 'center',
  },
  messageWarning: {
    color: RC_THEME.colors.warning,
  },
  presets: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 8,
  },
  presetButton: {
    width: '30%',
    minWidth: 84,
    minHeight: 42,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: RC_THEME.colors.border,
    borderRadius: RC_THEME.radius.small,
    backgroundColor: RC_THEME.colors.surface,
  },
  presetButtonActive: {
    borderColor: RC_THEME.colors.primary,
    backgroundColor: RC_THEME.colors.surfaceAccent,
    ...RC_THEME.shadow.glow,
  },
  presetButtonDisabled: {
    opacity: 0.45,
  },
  presetText: {
    color: RC_THEME.colors.textMuted,
    fontSize: 13,
    fontWeight: '700',
  },
  presetTextActive: {
    color: RC_THEME.colors.accentBright,
  },
  hint: {
    marginTop: 12,
    color: RC_THEME.colors.textMuted,
    fontSize: 11,
    lineHeight: 16,
    textAlign: 'center',
  },
});
