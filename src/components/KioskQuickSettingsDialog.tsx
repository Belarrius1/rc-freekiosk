import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Modal,
  NativeModules,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import BrightnessModule from '../utils/BrightnessModule';
import KioskModule from '../utils/KioskModule';
import UpdateModule, {
  ENABLE_SELF_UPDATE,
  isBatterySafeForPublicUpdate,
  isNewerRcRelease,
  isTrustedRcUpdateUrl,
  MIN_PUBLIC_UPDATE_BATTERY_PERCENT,
} from '../utils/UpdateModule';
import type { UpdateInfo } from '../utils/UpdateModule';
import { RC_THEME } from '../theme/relicCommanderTheme';

const { SystemInfoModule, UpdateModule: NativeUpdateModule } = NativeModules;

type PublicUpdateStatus =
  | 'idle'
  | 'checking'
  | 'up_to_date'
  | 'available'
  | 'installing'
  | 'blocked'
  | 'error';

export type KioskQuickSetting = 'wifi' | 'audio' | 'brightness' | 'bluetooth';

interface Props {
  visible: boolean;
  onClose: () => void;
  onSelect: (setting: KioskQuickSetting) => void;
  onMusic: () => void;
  onRelicCommanderHome: () => void;
  onTerminalAccount: () => void;
  terminalId?: string | null;
}

interface QuickStatus {
  batteryLevel: number | null;
  isCharging: boolean;
  wifiConnected: boolean;
  wifiSsid: string;
  wifiSignalLevel: number | null;
  brightness: number | null;
}

const EMPTY_STATUS: QuickStatus = {
  batteryLevel: null,
  isCharging: false,
  wifiConnected: false,
  wifiSsid: '',
  wifiSignalLevel: null,
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

function versionLabel(versionName: string): string {
  const normalized = versionName.trim().replace(/^v/i, '');
  return normalized ? `v${normalized}` : 'v--';
}

/** Customer-safe controls that never open the unrestricted Android Settings app. */
export default function KioskQuickSettingsDialog({
  visible,
  onClose,
  onSelect,
  onMusic,
  onRelicCommanderHome,
  onTerminalAccount,
  terminalId,
}: Props) {
  const [status, setStatus] = useState<QuickStatus>(EMPTY_STATUS);
  const [currentVersionName, setCurrentVersionName] = useState<string>(
    typeof NativeUpdateModule?.VERSION_NAME === 'string'
      ? NativeUpdateModule.VERSION_NAME
      : '',
  );
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [updateStatus, setUpdateStatus] = useState<PublicUpdateStatus>('idle');
  const [updateMessage, setUpdateMessage] = useState(
    'Check for a stable RC-FreeKiosk update.',
  );
  const updateCheckInFlightRef = useRef(false);
  const updateInstallationInFlightRef = useRef(false);
  const { width, height } = useWindowDimensions();
  const isLandscape = width > height;

  const handleCheckForUpdates = useCallback(async (): Promise<void> => {
    if (
      !ENABLE_SELF_UPDATE ||
      updateCheckInFlightRef.current ||
      updateInstallationInFlightRef.current
    ) {
      return;
    }

    updateCheckInFlightRef.current = true;
    setUpdateStatus('checking');
    setUpdateMessage('Checking the stable release channel…');
    setUpdateInfo(null);

    try {
      const [installed, latest] = await Promise.all([
        UpdateModule.getCurrentVersion(),
        UpdateModule.checkForUpdates(),
      ]);
      setCurrentVersionName(installed.versionName);

      if (isNewerRcRelease(latest.version, installed)) {
        setUpdateInfo(latest);
        setUpdateStatus('available');
        setUpdateMessage('A new update is available.');
      } else {
        setUpdateStatus('up_to_date');
        setUpdateMessage('This Terminal is up to date.');
      }
    } catch (error) {
      console.warn('[Menu] update check failed:', error);
      setUpdateStatus('error');
      setUpdateMessage(
        'Unable to check for updates. Verify the Wi-Fi connection.',
      );
    } finally {
      updateCheckInFlightRef.current = false;
    }
  }, []);

  useEffect(() => {
    if (!visible) return;
    let active = true;

    const refreshQuickStatus = async () => {
      try {
        const info = await SystemInfoModule?.getSystemInfo?.();
        if (active && info) {
          setStatus(current => ({
            ...current,
            batteryLevel:
              typeof info.battery?.level === 'number' &&
              info.battery.level >= 0 &&
              info.battery.level <= 100
                ? info.battery.level
                : null,
            isCharging: Boolean(info.battery?.isCharging),
            wifiConnected: Boolean(info.wifi?.isConnected),
            wifiSsid: info.wifi?.ssid || '',
            wifiSignalLevel:
              typeof info.wifi?.signalLevel === 'number' &&
              info.wifi.signalLevel >= 0 &&
              info.wifi.signalLevel <= 4
                ? Math.round(info.wifi.signalLevel)
                : null,
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

    refreshQuickStatus();
    handleCheckForUpdates();
    const interval = setInterval(refreshQuickStatus, 5000);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [handleCheckForUpdates, visible]);

  const batteryLabel =
    status.batteryLevel === null ? '--' : `${status.batteryLevel}%`;
  const brightnessLabel =
    status.brightness === null
      ? '--'
      : `${Math.round(status.brightness * 100)}%`;
  const wifiLabel = status.wifiConnected
    ? status.wifiSsid || 'Connected'
    : 'Offline';
  const wifiIcon = !status.wifiConnected
    ? 'wifi-strength-off-outline'
    : status.wifiSignalLevel === null
    ? 'wifi'
    : [
        'wifi-strength-outline',
        'wifi-strength-1',
        'wifi-strength-2',
        'wifi-strength-3',
        'wifi-strength-4',
      ][status.wifiSignalLevel];
  const displayedVersion = versionLabel(currentVersionName);
  const updateBusy =
    updateStatus === 'checking' || updateStatus === 'installing';
  const updateCanInstall =
    updateInfo !== null &&
    (updateStatus === 'available' || updateStatus === 'blocked');
  const availableVersionLabel = updateInfo
    ? versionLabel(updateInfo.version)
    : updateStatus === 'checking'
    ? 'Checking…'
    : updateStatus === 'up_to_date'
    ? 'No update'
    : updateStatus === 'error'
    ? 'Unavailable'
    : '--';

  const performInstall = async (release: UpdateInfo): Promise<void> => {
    updateInstallationInFlightRef.current = true;
    setUpdateStatus('installing');
    setUpdateMessage(`Downloading ${versionLabel(release.version)}…`);

    try {
      await UpdateModule.downloadAndInstallSilently(
        release.downloadUrl,
        release.version,
      );
      setUpdateMessage('Installation started. The terminal will restart.');
    } catch (error) {
      updateInstallationInFlightRef.current = false;
      console.warn('[Menu] update installation failed:', error);
      setUpdateStatus('error');
      setUpdateMessage(
        'The update could not be installed. Administrator action is required.',
      );
    }
  };

  const handleInstallUpdate = async (): Promise<void> => {
    if (!updateInfo || updateBusy) return;

    let batteryLevel: number | null = null;
    try {
      const info = await SystemInfoModule?.getSystemInfo?.();
      const level = info?.battery?.level;
      batteryLevel =
        typeof level === 'number' && level >= 0 && level <= 100 ? level : null;
    } catch (error) {
      console.warn('[Menu] battery safety check failed:', error);
    }

    if (!isBatterySafeForPublicUpdate(batteryLevel)) {
      setUpdateStatus('blocked');
      setUpdateMessage(
        batteryLevel === null
          ? 'Battery level unavailable. Update installation is blocked for safety.'
          : `Battery must be at least ${MIN_PUBLIC_UPDATE_BATTERY_PERCENT}% to install an update. Current level: ${batteryLevel}%.`,
      );
      return;
    }

    let isDeviceOwner = false;
    try {
      isDeviceOwner = await KioskModule.isDeviceOwner();
    } catch (error) {
      console.warn('[Menu] Device Owner check failed:', error);
    }

    if (!isDeviceOwner) {
      setUpdateStatus('blocked');
      setUpdateMessage(
        'Silent installation is unavailable. Administrator action is required.',
      );
      return;
    }

    if (!isTrustedRcUpdateUrl(updateInfo.downloadUrl)) {
      setUpdateStatus('error');
      setUpdateMessage('The update source was rejected by the terminal.');
      return;
    }

    Alert.alert(
      'Install RC-FreeKiosk update?',
      `Install ${versionLabel(
        updateInfo.version,
      )} now? The terminal will restart when installation completes.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Install',
          onPress: () => {
            performInstall(updateInfo);
          },
        },
      ],
    );
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
        <TouchableOpacity
          style={[styles.card, isLandscape && styles.cardLandscape]}
          activeOpacity={1}
        >
          <View style={styles.header}>
            <View>
              <Text style={styles.eyebrow}>
                RELIC COMMANDER TERMINAL - {displayedVersion}
              </Text>
              <Text style={styles.title}>Menu</Text>
              <Text style={styles.subtitle}>DEVICE &amp; GAME CONTROL</Text>
            </View>
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel="Close menu"
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

          <ScrollView
            style={styles.bodyScroll}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={[
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
                        name={wifiIcon}
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

              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel="Open Terminal account login"
                activeOpacity={0.75}
                style={styles.terminalAccountButton}
                onPress={onTerminalAccount}
              >
                <MaterialCommunityIcons
                  name={terminalId ? 'shield-account' : 'shield-key-outline'}
                  size={26}
                  color={RC_THEME.colors.accentBright}
                />
                <View style={styles.terminalAccountText}>
                  <Text style={styles.actionButtonLabel}>Terminal Account</Text>
                  <Text style={styles.terminalAccountStatus}>
                    {terminalId || 'Pair or sign in to Relic Commander'}
                  </Text>
                </View>
                <MaterialCommunityIcons
                  name="chevron-right"
                  size={24}
                  color={RC_THEME.colors.textMuted}
                />
              </TouchableOpacity>

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

              {ENABLE_SELF_UPDATE && (
                <View style={styles.updatePanel}>
                  <View style={styles.updateSummary}>
                    <MaterialCommunityIcons
                      name={
                        updateStatus === 'available'
                          ? 'update'
                          : updateStatus === 'up_to_date'
                          ? 'check-circle-outline'
                          : updateStatus === 'blocked' ||
                            updateStatus === 'error'
                          ? 'alert-circle-outline'
                          : 'cloud-download-outline'
                      }
                      size={25}
                      color={
                        updateStatus === 'blocked' || updateStatus === 'error'
                          ? RC_THEME.colors.warning
                          : RC_THEME.colors.accentBright
                      }
                    />
                    <View style={styles.updateTextGroup}>
                      <Text style={styles.updateTitle}>Terminal update</Text>
                      <Text style={styles.updateMessage}>{updateMessage}</Text>
                      <View style={styles.updateVersionsInline}>
                        <Text style={styles.updateVersionInlineText}>
                          <Text style={styles.updateVersionLabel}>Installed </Text>
                          <Text style={styles.updateVersionValue}>
                            {displayedVersion}
                          </Text>
                        </Text>
                        <MaterialCommunityIcons
                          name="arrow-right"
                          size={14}
                          color={RC_THEME.colors.textMuted}
                        />
                        <Text style={styles.updateVersionInlineText}>
                          <Text style={styles.updateVersionLabel}>Available </Text>
                          <Text
                            style={[
                              styles.updateVersionValue,
                              updateCanInstall && styles.updateVersionAvailable,
                            ]}
                          >
                            {availableVersionLabel}
                          </Text>
                        </Text>
                      </View>
                    </View>
                  </View>

                  <TouchableOpacity
                    accessibilityRole="button"
                    accessibilityLabel={
                      updateCanInstall
                        ? `Install ${versionLabel(updateInfo?.version ?? '')}`
                        : 'Check for updates'
                    }
                    disabled={updateBusy}
                    activeOpacity={0.75}
                    style={[
                      styles.updateButton,
                      updateBusy && styles.updateButtonDisabled,
                    ]}
                    onPress={
                      updateCanInstall
                        ? handleInstallUpdate
                        : handleCheckForUpdates
                    }
                  >
                    {updateBusy ? (
                      <ActivityIndicator
                        size="small"
                        color={RC_THEME.colors.textInverse}
                      />
                    ) : (
                      <MaterialCommunityIcons
                        name={updateCanInstall ? 'download' : 'magnify'}
                        size={20}
                        color={RC_THEME.colors.textInverse}
                      />
                    )}
                    <Text style={styles.updateButtonText}>
                      {updateCanInstall
                        ? `Install ${versionLabel(updateInfo?.version ?? '')}`
                        : updateStatus === 'up_to_date'
                        ? 'Check again'
                        : updateStatus === 'checking'
                        ? 'Checking…'
                        : updateStatus === 'installing'
                        ? 'Installing…'
                        : 'Check for updates'}
                    </Text>
                  </TouchableOpacity>

                  <Text style={styles.updateSafetyText}>
                    Update requires at least 50% battery.
                  </Text>
                </View>
              )}
            </View>
          </ScrollView>
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
    maxHeight: '92%',
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
  bodyScroll: {
    flexGrow: 0,
  },
  dialogBody: {
    width: '100%',
    paddingBottom: 2,
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
    rowGap: 10,
  },
  settingButton: {
    width: '48%',
    minHeight: 76,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: RC_THEME.colors.border,
    borderRadius: RC_THEME.radius.medium,
    backgroundColor: RC_THEME.colors.surface,
    ...RC_THEME.shadow.glow,
  },
  settingLabel: {
    marginTop: 6,
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
  terminalAccountButton: {
    minHeight: 62,
    marginTop: 12,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: 1,
    borderColor: RC_THEME.colors.primary,
    borderRadius: RC_THEME.radius.medium,
    backgroundColor: RC_THEME.colors.surfaceCardDeep,
  },
  terminalAccountText: {
    flex: 1,
    minWidth: 0,
  },
  terminalAccountStatus: {
    marginTop: 3,
    color: RC_THEME.colors.textMuted,
    fontSize: 10,
    letterSpacing: 0.4,
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
  updatePanel: {
    marginTop: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: RC_THEME.colors.borderStrong,
    borderRadius: RC_THEME.radius.medium,
    backgroundColor: RC_THEME.colors.surfaceCardDeep,
  },
  updateSummary: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  updateTextGroup: {
    flex: 1,
    minWidth: 0,
  },
  updateTitle: {
    color: RC_THEME.colors.textPrimary,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.7,
    textTransform: 'uppercase',
  },
  updateMessage: {
    marginTop: 3,
    color: RC_THEME.colors.textMuted,
    fontSize: 11,
    lineHeight: 15,
  },
  updateVersionsInline: {
    marginTop: 5,
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 5,
  },
  updateVersionInlineText: {
    fontSize: 10,
    lineHeight: 14,
  },
  updateVersionLabel: {
    color: RC_THEME.colors.textMuted,
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  updateVersionValue: {
    color: RC_THEME.colors.textSection,
    fontSize: 10,
    fontWeight: '800',
  },
  updateVersionAvailable: {
    color: RC_THEME.colors.success,
  },
  updateButton: {
    minHeight: 42,
    marginTop: 11,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: RC_THEME.radius.medium,
    backgroundColor: RC_THEME.colors.primary,
  },
  updateButtonDisabled: {
    opacity: 0.6,
  },
  updateButtonText: {
    color: RC_THEME.colors.textInverse,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  updateSafetyText: {
    marginTop: 8,
    color: RC_THEME.colors.textMuted,
    fontSize: 9,
    lineHeight: 13,
    textAlign: 'center',
  },
});
