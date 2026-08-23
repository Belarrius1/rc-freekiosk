import React, { useEffect, useState } from 'react';
import {
  Image,
  Modal,
  NativeModules,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import BrightnessModule from '../utils/BrightnessModule';
import { RC_THEME } from '../theme/relicCommanderTheme';

const { SystemInfoModule } = NativeModules;

export type KioskQuickSetting = 'wifi' | 'audio' | 'brightness' | 'bluetooth';

interface Props {
  visible: boolean;
  onClose: () => void;
  onSelect: (setting: KioskQuickSetting) => void;
  onMusic: () => void;
  onRelicCommanderHome: () => void;
}

interface QuickStatus {
  batteryLevel: number | null;
  isCharging: boolean;
  wifiConnected: boolean;
  wifiSsid: string;
  brightness: number | null;
}

const EMPTY_STATUS: QuickStatus = {
  batteryLevel: null,
  isCharging: false,
  wifiConnected: false,
  wifiSsid: '',
  brightness: null,
};

const QUICK_SETTINGS: Array<{
  key: KioskQuickSetting;
  label: string;
  icon: string;
}> = [
  { key: 'wifi', label: 'Wi-Fi', icon: 'wifi' },
  { key: 'audio', label: 'Audio', icon: 'volume-high' },
  { key: 'brightness', label: 'Brightness', icon: 'brightness-6' },
  { key: 'bluetooth', label: 'Bluetooth', icon: 'bluetooth' },
];

/** Customer-safe controls that never open the unrestricted Android Settings app. */
export default function KioskQuickSettingsDialog({
  visible,
  onClose,
  onSelect,
  onMusic,
  onRelicCommanderHome,
}: Props) {
  const [status, setStatus] = useState<QuickStatus>(EMPTY_STATUS);
  const { width, height } = useWindowDimensions();
  const isLandscape = width > height;

  useEffect(() => {
    if (!visible) return;
    let active = true;

    const updateStatus = async () => {
      try {
        const info = await SystemInfoModule?.getSystemInfo?.();
        if (active && info) {
          setStatus(current => ({
            ...current,
            batteryLevel:
              typeof info.battery?.level === 'number'
                ? info.battery.level
                : null,
            isCharging: Boolean(info.battery?.isCharging),
            wifiConnected: Boolean(info.wifi?.isConnected),
            wifiSsid: info.wifi?.ssid || '',
          }));
        }
      } catch (error) {
        console.warn('[QuickSettings] system status error:', error);
      }

      try {
        const brightness = await BrightnessModule.getBrightnessLevel();
        if (active) {
          setStatus(current => ({ ...current, brightness }));
        }
      } catch (error) {
        console.warn('[QuickSettings] brightness status error:', error);
      }
    };

    updateStatus();
    const interval = setInterval(updateStatus, 5000);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [visible]);

  const batteryLabel =
    status.batteryLevel === null ? '--' : `${status.batteryLevel}%`;
  const brightnessLabel =
    status.brightness === null
      ? '--'
      : `${Math.round(status.brightness * 100)}%`;
  const wifiLabel = status.wifiConnected
    ? status.wifiSsid || 'Connected'
    : 'Offline';

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
        <TouchableOpacity
          style={[styles.card, isLandscape && styles.cardLandscape]}
          activeOpacity={1}
        >
          <View style={styles.header}>
            <View>
              <Text style={styles.eyebrow}>RELIC COMMANDER TERMINAL</Text>
              <Text style={styles.title}>Quick settings</Text>
              <Text style={styles.subtitle}>DEVICE CONTROL</Text>
            </View>
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel="Close quick settings"
              hitSlop={{ top: 8, right: 8, bottom: 8, left: 8 }}
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

          <View
            style={[
              styles.dialogBody,
              isLandscape && styles.dialogBodyLandscape,
            ]}
          >
            <Image
              accessibilityLabel="Relic Commander Terminal"
              source={require('../../img/rc-terminal.png')}
              resizeMode="contain"
              style={[
                styles.terminalLogo,
                isLandscape && styles.terminalLogoLandscape,
              ]}
            />

            <View
              style={[
                styles.controlsColumn,
                isLandscape && styles.controlsColumnLandscape,
              ]}
            >
              <View style={styles.statusRow}>
                <View style={styles.statusItem}>
                  <MaterialCommunityIcons
                    name={status.isCharging ? 'battery-charging' : 'battery'}
                    size={20}
                    color={RC_THEME.colors.accentBright}
                  />
                  <Text style={styles.statusLabel}>Battery</Text>
                  <Text style={styles.statusValue}>{batteryLabel}</Text>
                </View>
                <View style={styles.statusItem}>
                  <MaterialCommunityIcons
                    name={status.wifiConnected ? 'wifi' : 'wifi-off'}
                    size={20}
                    color={
                      status.wifiConnected
                        ? RC_THEME.colors.success
                        : RC_THEME.colors.danger
                    }
                  />
                  <Text style={styles.statusLabel}>Wi-Fi</Text>
                  <Text style={styles.statusValue} numberOfLines={1}>
                    {wifiLabel}
                  </Text>
                </View>
                <View style={styles.statusItem}>
                  <MaterialCommunityIcons
                    name="brightness-6"
                    size={20}
                    color={RC_THEME.colors.accentBright}
                  />
                  <Text style={styles.statusLabel}>Brightness</Text>
                  <Text style={styles.statusValue}>{brightnessLabel}</Text>
                </View>
              </View>

              <View style={styles.grid}>
                {QUICK_SETTINGS.map(setting => (
                  <TouchableOpacity
                    key={setting.key}
                    accessibilityRole="button"
                    accessibilityLabel={`Configure ${setting.label}`}
                    activeOpacity={0.75}
                    style={styles.settingButton}
                    onPress={() => onSelect(setting.key)}
                  >
                    <MaterialCommunityIcons
                      name={setting.icon}
                      size={30}
                      color={RC_THEME.colors.accentBright}
                    />
                    <Text style={styles.settingLabel}>{setting.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              <View style={styles.actionRow}>
                <TouchableOpacity
                  accessibilityRole="button"
                  accessibilityLabel="Open music player"
                  activeOpacity={0.75}
                  style={styles.actionButton}
                  onPress={onMusic}
                >
                  <MaterialCommunityIcons
                    name="music-note"
                    size={24}
                    color={RC_THEME.colors.accentBright}
                  />
                  <Text style={styles.actionButtonLabel}>Music</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  accessibilityRole="button"
                  accessibilityLabel="Return to Relic Commander home"
                  activeOpacity={0.75}
                  style={styles.actionButton}
                  onPress={onRelicCommanderHome}
                >
                  <MaterialCommunityIcons
                    name="home-variant-outline"
                    size={24}
                    color={RC_THEME.colors.accentBright}
                  />
                  <Text style={styles.actionButtonLabel} numberOfLines={2}>
                    Relic Commander Home
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
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
    padding: 18,
    borderWidth: 1,
    borderColor: RC_THEME.colors.borderStrong,
    borderRadius: RC_THEME.radius.large,
    backgroundColor: RC_THEME.colors.surfaceCard,
    ...RC_THEME.shadow.card,
  },
  cardLandscape: {
    maxWidth: 880,
    paddingHorizontal: 22,
    paddingVertical: 16,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  title: {
    color: RC_THEME.colors.textPrimary,
    fontSize: 19,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  eyebrow: {
    marginBottom: 3,
    color: RC_THEME.colors.primary,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.8,
  },
  subtitle: {
    marginTop: 4,
    color: RC_THEME.colors.textMuted,
    fontSize: 11,
    letterSpacing: 1.2,
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
  terminalLogo: {
    width: '100%',
    maxWidth: 336,
    aspectRatio: 1,
    alignSelf: 'center',
    marginTop: -4,
    marginBottom: 14,
  },
  dialogBody: {
    width: '100%',
  },
  dialogBodyLandscape: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 24,
  },
  terminalLogoLandscape: {
    width: 250,
    height: 250,
    marginTop: 0,
    marginBottom: 0,
  },
  controlsColumn: {
    width: '100%',
  },
  controlsColumnLandscape: {
    flex: 1,
    width: 'auto',
  },
  statusRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 16,
  },
  statusItem: {
    flex: 1,
    minWidth: 0,
    minHeight: 66,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 5,
    paddingVertical: 7,
    borderWidth: 1,
    borderColor: RC_THEME.colors.border,
    borderRadius: RC_THEME.radius.small,
    backgroundColor: RC_THEME.colors.surfaceCardDeep,
  },
  statusLabel: {
    marginTop: 3,
    color: RC_THEME.colors.textMuted,
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  statusValue: {
    maxWidth: '100%',
    marginTop: 2,
    color: RC_THEME.colors.textSection,
    fontSize: 11,
    fontWeight: '700',
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    rowGap: 12,
  },
  settingButton: {
    width: '48%',
    minHeight: 92,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: RC_THEME.colors.border,
    borderRadius: RC_THEME.radius.medium,
    backgroundColor: RC_THEME.colors.surface,
    ...RC_THEME.shadow.glow,
  },
  settingLabel: {
    marginTop: 8,
    color: RC_THEME.colors.textSection,
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  actionRow: {
    marginTop: 12,
    flexDirection: 'row',
    gap: 10,
  },
  actionButton: {
    flex: 1,
    minHeight: 54,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    borderWidth: 1,
    borderColor: RC_THEME.colors.primary,
    borderRadius: RC_THEME.radius.medium,
    backgroundColor: RC_THEME.colors.surfaceCardDeep,
  },
  actionButtonLabel: {
    color: RC_THEME.colors.textSection,
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
});
