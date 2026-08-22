import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  NativeModules,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import { RC_THEME } from '../theme/relicCommanderTheme';

const { AudioControlModule } = NativeModules;

const OUTPUT_ICONS: Record<string, string> = {
  auto: 'volume-medium',
  speaker: 'volume-high',
  speaker_forced: 'volume-high',
  wired_headphones: 'headphones',
  wired_headset: 'headset',
  usb_headset: 'usb-port',
  hdmi: 'monitor-speaker',
  bluetooth_a2dp: 'bluetooth-audio',
  bluetooth_sco: 'microphone',
};

interface AudioOutput {
  id: string;
  label: string;
  type: string;
}

interface AudioInfo {
  isMuted: boolean;
  currentOutput: string;
  availableOutputs: AudioOutput[];
}

interface Props {
  visible: boolean;
  onClose: () => void;
}

export default function AudioOutputDialog({ visible, onClose }: Props) {
  const [audioInfo, setAudioInfo] = useState<AudioInfo | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const refreshAudio = useCallback(async () => {
    if (!AudioControlModule) return;
    setIsLoading(true);
    try {
      const info: AudioInfo = await AudioControlModule.getAudioInfo();
      setAudioInfo(info);
    } catch (e) {
      console.warn('[AudioOutputDialog] getAudioInfo error:', e);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (visible) refreshAudio();
  }, [visible, refreshAudio]);

  const handleSelectOutput = async (output: AudioOutput) => {
    try {
      await AudioControlModule.setAudioOutput(output.id);
      onClose();
    } catch (e) {
      console.warn('[AudioOutputDialog] setAudioOutput error:', e);
    }
  };

  const handleMuteToggle = async () => {
    if (!audioInfo) return;
    try {
      await AudioControlModule.setMuted(!audioInfo.isMuted);
      await refreshAudio();
    } catch (e) {
      console.warn('[AudioOutputDialog] setMuted error:', e);
    }
  };

  const outputs = audioInfo?.availableOutputs ?? [];

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
            <View>
              <Text style={styles.eyebrow}>RELIC COMMANDER TERMINAL</Text>
              <Text style={styles.title}>Audio control</Text>
            </View>
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel="Close audio controls"
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

          {isLoading && !audioInfo ? (
            <ActivityIndicator color={RC_THEME.colors.accentBright} />
          ) : (
            <>
              {outputs.map(out => {
                const isActive =
                  out.type === audioInfo?.currentOutput ||
                  out.id === audioInfo?.currentOutput;
                return (
                  <TouchableOpacity
                    key={`${out.id}-${out.label}`}
                    style={[styles.row, isActive && styles.rowActive]}
                    onPress={() => handleSelectOutput(out)}
                  >
                    <MaterialCommunityIcons
                      name={OUTPUT_ICONS[out.type] ?? 'volume-medium'}
                      size={25}
                      color={
                        isActive
                          ? RC_THEME.colors.accentBright
                          : RC_THEME.colors.textMuted
                      }
                      style={styles.rowIcon}
                    />
                    <Text
                      style={[
                        styles.rowLabel,
                        isActive && styles.rowLabelActive,
                      ]}
                    >
                      {out.label}
                    </Text>
                    {isActive && <Text style={styles.check}>ACTIVE</Text>}
                  </TouchableOpacity>
                );
              })}

              {outputs.length === 0 && (
                <Text style={styles.empty}>No selectable outputs found</Text>
              )}

              <TouchableOpacity
                style={styles.muteButton}
                onPress={handleMuteToggle}
              >
                <MaterialCommunityIcons
                  name={audioInfo?.isMuted ? 'volume-off' : 'volume-mute'}
                  size={22}
                  color={RC_THEME.colors.textInverse}
                  style={styles.muteIcon}
                />
                <Text style={styles.muteLabel}>
                  {audioInfo?.isMuted ? 'Unmute' : 'Mute'}
                </Text>
              </TouchableOpacity>
            </>
          )}
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: RC_THEME.colors.overlay,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  card: {
    width: '100%',
    maxWidth: 360,
    padding: 18,
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
    marginBottom: 16,
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
  row: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: RC_THEME.radius.medium,
    paddingHorizontal: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: RC_THEME.colors.border,
    backgroundColor: RC_THEME.colors.surface,
  },
  rowActive: {
    borderColor: RC_THEME.colors.primary,
    backgroundColor: RC_THEME.colors.surfaceAccent,
  },
  rowIcon: {
    width: 36,
  },
  rowLabel: {
    flex: 1,
    color: RC_THEME.colors.textSecondary,
    fontSize: 15,
    fontWeight: '600',
  },
  rowLabelActive: {
    color: RC_THEME.colors.textPrimary,
  },
  check: {
    color: RC_THEME.colors.accentBright,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.8,
  },
  empty: {
    color: RC_THEME.colors.textMuted,
    fontSize: 14,
    paddingVertical: 12,
    textAlign: 'center',
  },
  muteButton: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: RC_THEME.colors.primary,
    borderRadius: RC_THEME.radius.small,
    backgroundColor: RC_THEME.colors.primaryPressed,
    marginTop: 4,
    paddingHorizontal: 12,
  },
  muteIcon: {
    marginRight: 8,
  },
  muteLabel: {
    color: RC_THEME.colors.textInverse,
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
});
