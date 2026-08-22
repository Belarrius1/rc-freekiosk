/**
 * WifiDialog — lock-screen WiFi manager.
 *
 * Renders as a full-screen modal so it works whether it is shown from the
 * PIN screen or from this fork's kiosk Wi-Fi button. Never launches the system
 * Settings app, so it cannot be used as a back-door into other settings.
 *
 * Android 10+ note: WifiManager.setWifiEnabled() is blocked for many
 * non-system apps on API 29+. If the native module cannot toggle Wi-Fi, this
 * dialog reports the limitation instead of opening Android Settings, which
 * would create an escape route from kiosk mode.
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  TextInput,
  FlatList,
  ActivityIndicator,
  StyleSheet,
  Switch,
  DeviceEventEmitter,
  Alert,
  Keyboard,
  useWindowDimensions,
} from 'react-native';
import { NativeModules } from 'react-native';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import {
  clearSecureWifiPassword,
  getSecureWifiPassword,
  saveSecureWifiPassword,
} from '../utils/secureStorage';
import { RC_THEME } from '../theme/relicCommanderTheme';

const { WifiControlModule } = NativeModules;

interface WifiNetwork {
  ssid: string;
  bssid: string;
  signalLevel: number; // 0–4
  rssi: number;
  secured: boolean;
  capabilities: string;
}

interface WifiInfo {
  isEnabled: boolean;
  isConnected: boolean;
  ssid: string;
  signalLevel: number;
  rssi: number;
}

interface Props {
  visible: boolean;
  onClose: () => void;
}

const SIGNAL_ICONS = ['▂___', '▂▄__', '▂▄▆_', '▂▄▆█'];

const normalizeSsid = (ssid: string) => ssid.replace(/^"|"$/g, '').trim();

const wait = (durationMs: number) =>
  new Promise<void>(resolve => setTimeout(resolve, durationMs));

export default function WifiDialog({ visible, onClose }: Props) {
  const { width, height } = useWindowDimensions();
  const isLandscape = width > height;
  const [wifiInfo, setWifiInfo] = useState<WifiInfo | null>(null);
  const [networks, setNetworks] = useState<WifiNetwork[]>([]);
  const [scanning, setScanning] = useState(false);
  const [connecting, setConnecting] = useState<string | null>(null); // ssid being connected
  const [passwordSsid, setPasswordSsid] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [togglingWifi, setTogglingWifi] = useState(false);
  const [disconnectingWifi, setDisconnectingWifi] = useState(false);
  const wifiInfoRef = useRef<WifiInfo | null>(null);
  const connectingRef = useRef<string | null>(null);
  const autoConnectingSsidRef = useRef<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const info: WifiInfo = await WifiControlModule.getWifiInfo();
      setWifiInfo(info);
    } catch (e) {
      console.warn('[WifiDialog] getWifiInfo error:', e);
    }
  }, []);

  useEffect(() => {
    wifiInfoRef.current = wifiInfo;
  }, [wifiInfo]);

  useEffect(() => {
    connectingRef.current = connecting;
  }, [connecting]);

  useEffect(() => {
    if (!visible) return;
    refresh();

    const sub = DeviceEventEmitter.addListener(
      'wifiScanResults',
      (results: WifiNetwork[]) => {
        setNetworks(results);
        setScanning(false);
        autoConnectKnownNetwork(results).catch(error => {
          console.warn('[WifiDialog] known-network connection error:', error);
        });
      },
    );
    // The scan listener intentionally remains stable while the modal is open;
    // connection state is read through refs inside autoConnectKnownNetwork.
    return () => sub.remove();
  }, [visible, refresh]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleToggleWifi = async () => {
    if (!wifiInfo || togglingWifi) return;
    const previousInfo = wifiInfo;
    const nextEnabled = !wifiInfo.isEnabled;
    setTogglingWifi(true);
    setWifiInfo({
      ...wifiInfo,
      isEnabled: nextEnabled,
      isConnected: nextEnabled ? wifiInfo.isConnected : false,
      ssid: nextEnabled ? wifiInfo.ssid : '',
      signalLevel: nextEnabled ? wifiInfo.signalLevel : 0,
      rssi: nextEnabled ? wifiInfo.rssi : 0,
    });
    if (!nextEnabled) {
      setNetworks([]);
      setConnecting(null);
    }

    try {
      const result = await WifiControlModule.setWifiEnabled(nextEnabled);
      if (result.requiresSystemPanel) {
        setWifiInfo(previousInfo);
        // Android 10+: WifiManager.setWifiEnabled() is blocked for non-system apps.
        // We do NOT open the system Settings panel — that would create a potential
        // escape route from kiosk mode. Instead inform the user.
        Alert.alert(
          'WiFi toggle unavailable',
          'On this Android version, WiFi can only be toggled via the device status bar or by an administrator. Connect to a network below while WiFi is already on.',
        );
      } else if (result.success === false) {
        setWifiInfo(previousInfo);
        Alert.alert(
          'Wi-Fi toggle failed',
          `Could not turn Wi-Fi ${nextEnabled ? 'on' : 'off'}.`,
        );
      } else {
        setTimeout(async () => {
          await refresh();
          if (nextEnabled) {
            handleScan(true);
          }
        }, 800);
      }
    } catch (e) {
      setWifiInfo(previousInfo);
      console.warn('[WifiDialog] toggle error:', e);
      Alert.alert(
        'Wi-Fi toggle failed',
        `Could not turn Wi-Fi ${nextEnabled ? 'on' : 'off'}.`,
      );
    } finally {
      setTogglingWifi(false);
    }
  };

  const handleScan = async (force = false) => {
    if (scanning || (!force && !wifiInfo?.isEnabled)) return;
    setScanning(true);
    setNetworks([]);
    try {
      const started = await WifiControlModule.startScan();
      if (!started) {
        const cachedResults: WifiNetwork[] =
          await WifiControlModule.getScanResults();
        setNetworks(cachedResults);
        setScanning(false);
      }
      // Results arrive via 'wifiScanResults' event
      // Safety timeout in case the event never fires
      setTimeout(() => setScanning(false), 12000);
    } catch (e: any) {
      setScanning(false);
      console.warn('[WifiDialog] scan error:', e);
      Alert.alert(
        'Wi-Fi scan unavailable',
        e?.message ||
          'FreeKiosk does not have permission to scan for Wi-Fi networks.',
      );
    }
  };

  const handleNetworkTap = async (network: WifiNetwork) => {
    const isCurrentNetwork =
      wifiInfo?.isConnected && wifiInfo.ssid === network.ssid;
    if (isCurrentNetwork) {
      await refresh();
      return;
    }

    if (network.secured) {
      const savedPassword = await getSecureWifiPassword(network.ssid);
      if (savedPassword) {
        connectTo(network.ssid, savedPassword, true);
        return;
      }

      setPasswordSsid(network.ssid);
      setPassword('');
    } else {
      connectTo(network.ssid, '');
    }
  };

  const closePasswordPrompt = () => {
    Keyboard.dismiss();
    setPasswordSsid(null);
    setPassword('');
    setShowPassword(false);
  };

  const waitForConnectedUiState = async (ssid: string) => {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      try {
        const info: WifiInfo = await WifiControlModule.getWifiInfo();
        setWifiInfo(info);
        if (
          info.isConnected &&
          normalizeSsid(info.ssid) === normalizeSsid(ssid)
        ) {
          return true;
        }
      } catch (e) {
        console.warn('[WifiDialog] connection status refresh error:', e);
      }
      await wait(500);
    }
    return false;
  };

  const connectTo = async (
    ssid: string,
    pwd: string,
    usedSavedPassword = false,
  ) => {
    Keyboard.dismiss();
    setPasswordSsid(null);
    setShowPassword(false);
    setConnecting(ssid);
    connectingRef.current = ssid;
    try {
      const result = await WifiControlModule.connectToNetwork(ssid, pwd);
      if (result.success) {
        if (pwd) {
          await saveSecureWifiPassword(ssid, pwd);
        }
        const stateConfirmed = await waitForConnectedUiState(ssid);
        if (!stateConfirmed) {
          const selectedNetwork = networks.find(
            network => normalizeSsid(network.ssid) === normalizeSsid(ssid),
          );
          // The native promise only succeeds after Android reports association.
          // Some OEMs update the public active-network API a little later.
          setWifiInfo({
            isEnabled: true,
            isConnected: true,
            ssid: result.ssid || ssid,
            signalLevel: selectedNetwork?.signalLevel ?? 0,
            rssi: selectedNetwork?.rssi ?? 0,
          });
        }
        setPassword('');
      } else {
        if (usedSavedPassword) {
          await clearSecureWifiPassword(ssid);
          setPasswordSsid(ssid);
          setPassword('');
          setShowPassword(false);
          Alert.alert(
            'Saved Wi-Fi password failed',
            `Enter the password for "${ssid}" again.`,
          );
          return;
        }
        Alert.alert('Connection failed', `Could not connect to "${ssid}"`);
      }
    } catch (e: any) {
      if (usedSavedPassword) {
        await clearSecureWifiPassword(ssid);
        setPasswordSsid(ssid);
        setPassword('');
        setShowPassword(false);
        Alert.alert(
          'Saved Wi-Fi password failed',
          e?.message || `Enter the password for "${ssid}" again.`,
        );
        return;
      }
      Alert.alert(
        'Connection failed',
        e?.message || `Could not connect to "${ssid}"`,
      );
    } finally {
      setConnecting(null);
      connectingRef.current = null;
      if (autoConnectingSsidRef.current === ssid) {
        autoConnectingSsidRef.current = null;
      }
    }
  };

  const autoConnectKnownNetwork = async (scanResults: WifiNetwork[]) => {
    const currentInfo = wifiInfoRef.current;
    if (
      !currentInfo?.isEnabled ||
      currentInfo.isConnected ||
      connectingRef.current ||
      autoConnectingSsidRef.current
    ) {
      return;
    }

    for (const network of scanResults) {
      if (!network.secured) continue;
      const savedPassword = await getSecureWifiPassword(network.ssid);
      if (!savedPassword) continue;

      autoConnectingSsidRef.current = network.ssid;
      connectTo(network.ssid, savedPassword, true);
      return;
    }
  };

  const handleDisconnect = async () => {
    if (!wifiInfo?.isConnected || disconnectingWifi) return;
    const previousInfo = wifiInfo;
    setDisconnectingWifi(true);
    setWifiInfo({
      ...wifiInfo,
      isConnected: false,
      ssid: '',
      signalLevel: 0,
      rssi: 0,
    });
    try {
      const result = await WifiControlModule.disconnectFromCurrentNetwork();
      if (result.success === false) {
        setWifiInfo(previousInfo);
        Alert.alert(
          'Disconnect failed',
          `Could not disconnect from "${previousInfo.ssid}".`,
        );
      } else {
        setTimeout(refresh, 700);
        setTimeout(refresh, 1800);
      }
    } catch (e: any) {
      setWifiInfo(previousInfo);
      Alert.alert(
        'Disconnect failed',
        e?.message || `Could not disconnect from "${previousInfo.ssid}".`,
      );
    } finally {
      setDisconnectingWifi(false);
    }
  };

  const signalIcon = (level: number) =>
    SIGNAL_ICONS[Math.min(level, 3)] ?? SIGNAL_ICONS[0];

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent={false}
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View style={styles.container}>
        {/* Header */}
        <View style={[styles.header, isLandscape && styles.headerLandscape]}>
          <View style={styles.headerTitleRow}>
            <MaterialCommunityIcons
              name="wifi-cog"
              size={25}
              color={RC_THEME.colors.accentBright}
            />
            <View>
              <Text style={styles.headerEyebrow}>RELIC COMMANDER TERMINAL</Text>
              <Text style={styles.headerTitle}>Wi-Fi control</Text>
            </View>
          </View>
          <TouchableOpacity style={styles.closeBtn} onPress={onClose}>
            <MaterialCommunityIcons
              name="close"
              size={23}
              color={RC_THEME.colors.textSecondary}
            />
          </TouchableOpacity>
        </View>

        {/* Toggle row */}
        <View style={styles.toggleRow}>
          <Text style={styles.toggleLabel}>Wi-Fi</Text>
          <Switch
            value={wifiInfo?.isEnabled ?? false}
            onValueChange={handleToggleWifi}
            disabled={togglingWifi}
            trackColor={{
              false: RC_THEME.colors.surfaceElevated,
              true: RC_THEME.colors.primary,
            }}
            thumbColor={
              wifiInfo?.isEnabled
                ? RC_THEME.colors.accentBright
                : RC_THEME.colors.textMuted
            }
          />
        </View>

        {wifiInfo?.isEnabled && (
          <>
            {/* Current connection */}
            {wifiInfo.isConnected && (
              <View style={styles.connectedBanner}>
                <Text style={styles.connectedText}>
                  ✓ Connected: {wifiInfo.ssid}
                  {'  '}
                  {signalIcon(wifiInfo.signalLevel)}
                </Text>
                <TouchableOpacity
                  style={[
                    styles.disconnectBtn,
                    disconnectingWifi && styles.disconnectBtnDisabled,
                  ]}
                  onPress={handleDisconnect}
                  disabled={disconnectingWifi}
                >
                  {disconnectingWifi ? (
                    <ActivityIndicator
                      color={RC_THEME.colors.success}
                      size="small"
                    />
                  ) : (
                    <Text style={styles.disconnectBtnText}>Disconnect</Text>
                  )}
                </TouchableOpacity>
              </View>
            )}

            {/* Scan button */}
            <TouchableOpacity
              style={[styles.scanBtn, scanning && styles.scanBtnDisabled]}
              onPress={() => handleScan()}
              disabled={scanning}
            >
              {scanning ? (
                <ActivityIndicator
                  color={RC_THEME.colors.textInverse}
                  size="small"
                />
              ) : (
                <View style={styles.buttonContent}>
                  <MaterialCommunityIcons
                    name="radar"
                    size={19}
                    color={RC_THEME.colors.textInverse}
                  />
                  <Text style={styles.scanBtnText}>Scan for networks</Text>
                </View>
              )}
            </TouchableOpacity>

            {/* Network list */}
            <FlatList
              data={networks}
              keyExtractor={n => n.bssid || n.ssid}
              contentContainerStyle={styles.listContent}
              renderItem={({ item }) => {
                const isConnecting = connecting === item.ssid;
                const isCurrentNetwork =
                  wifiInfo.isConnected && wifiInfo.ssid === item.ssid;
                return (
                  <TouchableOpacity
                    style={[
                      styles.networkRow,
                      isCurrentNetwork && styles.networkRowActive,
                    ]}
                    onPress={() => handleNetworkTap(item)}
                    disabled={isConnecting}
                  >
                    <View style={styles.networkInfo}>
                      <Text style={styles.networkSsid} numberOfLines={1}>
                        {item.ssid}
                      </Text>
                      <Text style={styles.networkMeta}>
                        {item.secured ? '🔒' : '🔓'}
                        {'  '}
                        {signalIcon(item.signalLevel)}
                      </Text>
                    </View>
                    {isConnecting ? (
                      <ActivityIndicator
                        color={RC_THEME.colors.accentBright}
                        size="small"
                      />
                    ) : isCurrentNetwork ? (
                      <Text style={styles.connectedBadge}>Connected</Text>
                    ) : (
                      <Text style={styles.connectArrow}>›</Text>
                    )}
                  </TouchableOpacity>
                );
              }}
              ListEmptyComponent={
                !scanning ? (
                  <Text style={styles.emptyText}>
                    Tap "Scan" to find networks
                  </Text>
                ) : null
              }
            />
          </>
        )}

        {!wifiInfo?.isEnabled && (
          <Text style={styles.disabledText}>
            Turn on Wi-Fi to see available networks.
          </Text>
        )}
      </View>

      {/* Password dialog */}
      {passwordSsid !== null && (
        <Modal
          visible
          transparent
          animationType="fade"
          onRequestClose={closePasswordPrompt}
        >
          <View style={styles.pwdOverlay}>
            <View style={styles.pwdCard}>
              <Text style={styles.pwdTitle}>Connect to</Text>
              <Text style={styles.pwdSsid} numberOfLines={1}>
                {passwordSsid}
              </Text>

              <View style={styles.pwdInputRow}>
                <TextInput
                  style={styles.pwdInput}
                  value={password}
                  onChangeText={setPassword}
                  secureTextEntry={!showPassword}
                  placeholder="Password"
                  placeholderTextColor={RC_THEME.colors.textMuted}
                  autoFocus
                  autoCapitalize="none"
                  autoCorrect={false}
                />
                <TouchableOpacity
                  style={styles.eyeBtn}
                  onPress={() => setShowPassword(v => !v)}
                >
                  <Text style={styles.eyeBtnText}>
                    {showPassword ? '🙈' : '👁️'}
                  </Text>
                </TouchableOpacity>
              </View>

              <View style={styles.pwdActions}>
                <TouchableOpacity
                  style={styles.pwdCancel}
                  onPress={closePasswordPrompt}
                >
                  <Text style={styles.pwdCancelText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.pwdConnect,
                    !password && styles.pwdConnectDisabled,
                  ]}
                  onPress={() => connectTo(passwordSsid!, password, false)}
                  disabled={!password}
                >
                  <Text style={styles.pwdConnectText}>Connect</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>
      )}
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: RC_THEME.colors.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: RC_THEME.colors.header,
    paddingTop: 48,
    paddingBottom: 16,
    paddingHorizontal: 20,
    borderBottomWidth: 1,
    borderBottomColor: RC_THEME.colors.borderStrong,
  },
  headerLandscape: {
    paddingTop: 18,
    paddingBottom: 12,
  },
  headerTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  headerEyebrow: {
    marginBottom: 2,
    color: RC_THEME.colors.primary,
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 1.7,
  },
  headerTitle: {
    color: RC_THEME.colors.textPrimary,
    fontSize: 20,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  closeBtn: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: RC_THEME.colors.border,
    borderRadius: RC_THEME.radius.pill,
    backgroundColor: RC_THEME.colors.surfaceInput,
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: RC_THEME.colors.surfaceCard,
    margin: 16,
    marginBottom: 8,
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderWidth: 1,
    borderColor: RC_THEME.colors.border,
    borderRadius: RC_THEME.radius.large,
    width: '92%',
    maxWidth: 900,
    alignSelf: 'center',
    marginHorizontal: 0,
  },
  toggleLabel: {
    fontSize: 18,
    fontWeight: '700',
    color: RC_THEME.colors.textSection,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  connectedBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: RC_THEME.colors.successBackground,
    marginHorizontal: 0,
    marginTop: 4,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: RC_THEME.colors.success,
    borderRadius: RC_THEME.radius.medium,
    width: '92%',
    maxWidth: 900,
    alignSelf: 'center',
  },
  connectedText: {
    color: RC_THEME.colors.success,
    fontSize: 15,
    fontWeight: '600',
    flex: 1,
    marginRight: 12,
  },
  disconnectBtn: {
    minWidth: 104,
    minHeight: 34,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: RC_THEME.colors.success,
    borderRadius: RC_THEME.radius.small,
    paddingHorizontal: 10,
  },
  disconnectBtnDisabled: {
    opacity: 0.6,
  },
  disconnectBtnText: {
    color: RC_THEME.colors.success,
    fontSize: 13,
    fontWeight: '700',
  },
  scanBtn: {
    backgroundColor: RC_THEME.colors.primaryPressed,
    marginHorizontal: 0,
    marginVertical: 12,
    paddingVertical: 14,
    borderWidth: 1,
    borderColor: RC_THEME.colors.primary,
    borderRadius: RC_THEME.radius.small,
    alignItems: 'center',
    width: '92%',
    maxWidth: 900,
    alignSelf: 'center',
    ...RC_THEME.shadow.glow,
  },
  scanBtnDisabled: {
    borderColor: RC_THEME.colors.disabled,
    backgroundColor: RC_THEME.colors.surfaceElevated,
    shadowOpacity: 0,
    elevation: 0,
  },
  buttonContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
  },
  scanBtnText: {
    color: RC_THEME.colors.textInverse,
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  listContent: {
    width: '92%',
    maxWidth: 900,
    alignSelf: 'center',
    paddingBottom: 24,
  },
  networkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: RC_THEME.colors.surface,
    borderWidth: 1,
    borderColor: RC_THEME.colors.border,
    borderRadius: RC_THEME.radius.medium,
    marginBottom: 8,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  networkRowActive: {
    borderColor: RC_THEME.colors.primary,
    backgroundColor: RC_THEME.colors.surfaceAccent,
    ...RC_THEME.shadow.glow,
  },
  networkInfo: {
    flex: 1,
  },
  networkSsid: {
    fontSize: 16,
    fontWeight: '600',
    color: RC_THEME.colors.textPrimary,
  },
  networkMeta: {
    fontSize: 13,
    color: RC_THEME.colors.textMuted,
    marginTop: 2,
    letterSpacing: 1,
  },
  connectedBadge: {
    fontSize: 13,
    color: RC_THEME.colors.accentBright,
    fontWeight: '700',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  connectArrow: {
    fontSize: 24,
    color: RC_THEME.colors.accentInfo,
  },
  emptyText: {
    textAlign: 'center',
    color: RC_THEME.colors.textMuted,
    marginTop: 40,
    fontSize: 15,
  },
  disabledText: {
    textAlign: 'center',
    color: RC_THEME.colors.textMuted,
    marginTop: 60,
    fontSize: 16,
    paddingHorizontal: 40,
  },
  // Password dialog
  pwdOverlay: {
    flex: 1,
    backgroundColor: RC_THEME.colors.overlay,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  pwdCard: {
    backgroundColor: RC_THEME.colors.surfaceCard,
    borderWidth: 1,
    borderColor: RC_THEME.colors.borderStrong,
    borderRadius: RC_THEME.radius.large,
    padding: 24,
    width: '100%',
    maxWidth: 400,
    ...RC_THEME.shadow.card,
  },
  pwdTitle: {
    fontSize: 12,
    color: RC_THEME.colors.textMuted,
    marginBottom: 4,
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  pwdSsid: {
    fontSize: 20,
    fontWeight: 'bold',
    color: RC_THEME.colors.textPrimary,
    marginBottom: 20,
  },
  pwdInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: RC_THEME.colors.primary,
    borderRadius: RC_THEME.radius.medium,
    marginBottom: 20,
    backgroundColor: RC_THEME.colors.surfaceInput,
  },
  pwdInput: {
    flex: 1,
    height: 52,
    paddingHorizontal: 14,
    fontSize: 18,
    color: RC_THEME.colors.textPrimary,
  },
  eyeBtn: {
    paddingHorizontal: 12,
  },
  eyeBtnText: {
    fontSize: 20,
  },
  pwdActions: {
    flexDirection: 'row',
    gap: 12,
  },
  pwdCancel: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: RC_THEME.radius.small,
    borderWidth: 1,
    borderColor: RC_THEME.colors.border,
    alignItems: 'center',
    backgroundColor: RC_THEME.colors.surface,
  },
  pwdCancelText: {
    fontSize: 16,
    color: RC_THEME.colors.textSecondary,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  pwdConnect: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: RC_THEME.radius.small,
    borderWidth: 1,
    borderColor: RC_THEME.colors.primary,
    backgroundColor: RC_THEME.colors.primaryPressed,
    alignItems: 'center',
  },
  pwdConnectDisabled: {
    borderColor: RC_THEME.colors.disabled,
    backgroundColor: RC_THEME.colors.surfaceElevated,
  },
  pwdConnectText: {
    fontSize: 16,
    color: RC_THEME.colors.textInverse,
    fontWeight: 'bold',
    letterSpacing: 0.7,
    textTransform: 'uppercase',
  },
});
