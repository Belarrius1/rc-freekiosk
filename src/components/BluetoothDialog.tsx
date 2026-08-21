/**
 * BluetoothDialog — lock-screen Bluetooth manager.
 *
 * Shows paired devices with connection state, lets the user scan for new
 * devices, and initiates pairing — all without leaving the app or accessing
 * unrestricted Settings.
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  FlatList,
  ActivityIndicator,
  StyleSheet,
  Switch,
  DeviceEventEmitter,
  Alert,
} from 'react-native';
import { NativeModules } from 'react-native';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import { RC_THEME } from '../theme/relicCommanderTheme';

const { BluetoothControlModule } = NativeModules;

interface BTDevice {
  address: string;
  name: string;
  rssi?: number;
  connected?: boolean;
  bonded?: boolean;
  type?: number;
}

interface BTInfo {
  supported: boolean;
  isEnabled: boolean;
  bondedDevices: BTDevice[];
}

interface Props {
  visible: boolean;
  onClose: () => void;
}

export default function BluetoothDialog({ visible, onClose }: Props) {
  const [btInfo, setBtInfo] = useState<BTInfo | null>(null);
  const [discoveredDevices, setDiscoveredDevices] = useState<BTDevice[]>([]);
  const [discovering, setDiscovering] = useState(false);
  const [togglingBt, setTogglingBt] = useState(false);
  const [pairingAddress, setPairingAddress] = useState<string | null>(null);
  const [connectingAddress, setConnectingAddress] = useState<string | null>(
    null,
  );
  const [disconnectingAddress, setDisconnectingAddress] = useState<
    string | null
  >(null);
  const [removingAddress, setRemovingAddress] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const info: BTInfo = await BluetoothControlModule.getBluetoothInfo();
      setBtInfo(info);
    } catch (e) {
      console.warn('[BluetoothDialog] getBluetoothInfo error:', e);
    }
  }, []);

  const updateBondedDeviceConnection = (
    address: string,
    connected: boolean,
  ) => {
    setBtInfo(current =>
      current
        ? {
            ...current,
            bondedDevices: current.bondedDevices.map(device =>
              device.address === address ? { ...device, connected } : device,
            ),
          }
        : current,
    );
  };

  const refreshSoon = () => {
    setTimeout(refresh, 700);
    setTimeout(refresh, 1800);
  };

  const waitForBluetoothState = async (enabled: boolean, timeoutMs = 8000) => {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      try {
        const info: BTInfo = await BluetoothControlModule.getBluetoothInfo();
        setBtInfo(info);
        if (info.isEnabled === enabled) return true;
      } catch (e) {
        console.warn('[BluetoothDialog] state poll error:', e);
      }
      await new Promise<void>(resolve => setTimeout(resolve, 600));
    }
    return false;
  };

  useEffect(() => {
    if (!visible) return;
    refresh();
    setDiscoveredDevices([]);
    setDiscovering(false);

    const foundSub = DeviceEventEmitter.addListener(
      'bluetoothDeviceFound',
      (device: BTDevice) => {
        setDiscoveredDevices(prev => {
          const exists = prev.some(d => d.address === device.address);
          return exists ? prev : [...prev, device];
        });
      },
    );
    const doneSub = DeviceEventEmitter.addListener(
      'bluetoothDiscoveryFinished',
      () => {
        setDiscovering(false);
      },
    );

    return () => {
      foundSub.remove();
      doneSub.remove();
    };
  }, [visible, refresh]);

  const handleToggleBt = async () => {
    if (!btInfo || togglingBt) return;
    const previousInfo = btInfo;
    const nextEnabled = !btInfo.isEnabled;
    setTogglingBt(true);
    setBtInfo({
      ...btInfo,
      isEnabled: nextEnabled,
      bondedDevices: nextEnabled ? btInfo.bondedDevices : [],
    });
    if (!nextEnabled) {
      setDiscoveredDevices([]);
      setPairingAddress(null);
      setConnectingAddress(null);
      setDisconnectingAddress(null);
      setRemovingAddress(null);
      setDiscovering(false);
    }
    try {
      const result = await BluetoothControlModule.setBluetoothEnabled(
        nextEnabled,
      );
      if (result.requiresSystemPanel) {
        setBtInfo(previousInfo);
        // Do NOT open system Settings panels — that would break kiosk isolation.
        Alert.alert(
          'Bluetooth toggle unavailable',
          'Bluetooth could not be toggled on this device. Please ask an administrator to enable it.',
        );
      } else if (result.success === false) {
        const reachedState = await waitForBluetoothState(nextEnabled);
        if (!reachedState) {
          setBtInfo(previousInfo);
          Alert.alert(
            'Bluetooth toggle failed',
            `Could not turn Bluetooth ${nextEnabled ? 'on' : 'off'}.`,
          );
        }
      } else {
        const reachedState = await waitForBluetoothState(nextEnabled, 5000);
        if (!reachedState) refreshSoon();
      }
    } catch (e) {
      setBtInfo(previousInfo);
      console.warn('[BluetoothDialog] toggle error:', e);
      Alert.alert(
        'Bluetooth toggle failed',
        `Could not turn Bluetooth ${nextEnabled ? 'on' : 'off'}.`,
      );
    } finally {
      setTogglingBt(false);
    }
  };

  const handleScan = async () => {
    if (discovering || !btInfo?.isEnabled) return;
    setDiscovering(true);
    setDiscoveredDevices([]);
    try {
      await BluetoothControlModule.startDiscovery();
      // Discovery typically lasts ~12 s; the receiver emits bluetoothDiscoveryFinished
      setTimeout(() => setDiscovering(false), 15000);
    } catch (e: any) {
      setDiscovering(false);
      Alert.alert('Scan error', e?.message ?? 'Could not start Bluetooth scan');
    }
  };

  const handlePair = async (device: BTDevice) => {
    if (pairingAddress) return;
    setPairingAddress(device.address);
    try {
      await BluetoothControlModule.pairDevice(device.address);
      await refresh();
      // Remove from discovered list once paired
      setDiscoveredDevices(prev =>
        prev.filter(d => d.address !== device.address),
      );
    } catch (e: any) {
      Alert.alert('Pairing failed', e?.message ?? 'Could not pair with device');
    } finally {
      setPairingAddress(null);
    }
  };

  const handleConnect = async (device: BTDevice) => {
    if (connectingAddress || disconnectingAddress) return;
    setConnectingAddress(device.address);
    try {
      const success = await BluetoothControlModule.connectDevice(
        device.address,
      );
      if (!success) {
        Alert.alert(
          'Connection failed',
          'Could not connect to this paired device.',
        );
      } else {
        updateBondedDeviceConnection(device.address, true);
      }
      refreshSoon();
    } catch (e: any) {
      Alert.alert(
        'Connection failed',
        e?.message ?? 'Could not connect to device',
      );
    } finally {
      setConnectingAddress(null);
    }
  };

  const handleDisconnect = async (device: BTDevice) => {
    if (connectingAddress || disconnectingAddress) return;
    setDisconnectingAddress(device.address);
    try {
      const success = await BluetoothControlModule.disconnectDevice(
        device.address,
      );
      if (!success) {
        Alert.alert('Disconnect failed', 'Could not disconnect this device.');
      } else {
        updateBondedDeviceConnection(device.address, false);
      }
      refreshSoon();
    } catch (e: any) {
      Alert.alert(
        'Disconnect failed',
        e?.message ?? 'Could not disconnect device',
      );
    } finally {
      setDisconnectingAddress(null);
    }
  };

  const performRemovePairedDevice = async (device: BTDevice) => {
    if (
      connectingAddress ||
      disconnectingAddress ||
      removingAddress ||
      pairingAddress
    )
      return;
    setRemovingAddress(device.address);
    try {
      if (device.connected) {
        try {
          await BluetoothControlModule.disconnectDevice(device.address);
          updateBondedDeviceConnection(device.address, false);
        } catch (e) {
          console.warn('[BluetoothDialog] disconnect before unpair failed:', e);
        }
      }
      const success = await BluetoothControlModule.unpairDevice(device.address);
      if (!success) {
        Alert.alert('Remove failed', 'Could not remove this paired device.');
      }
      refreshSoon();
    } catch (e: any) {
      Alert.alert(
        'Remove failed',
        e?.message ?? 'Could not remove this paired device.',
      );
    } finally {
      setRemovingAddress(null);
    }
  };

  const handleRemovePairedDevice = (device: BTDevice) => {
    Alert.alert('Remove paired device', `Forget ${device.name}?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: () => {
          performRemovePairedDevice(device).catch(error => {
            console.warn(
              '[BluetoothDialog] remove paired device error:',
              error,
            );
          });
        },
      },
    ]);
  };

  const rssiToSignal = (rssi?: number) => {
    if (rssi == null) return '?';
    if (rssi >= -55) return '████';
    if (rssi >= -67) return '▂▄▆_';
    if (rssi >= -75) return '▂▄__';
    return '▂___';
  };

  const renderBondedDevice = ({ item }: { item: BTDevice }) => {
    const isConnecting = connectingAddress === item.address;
    const isDisconnecting = disconnectingAddress === item.address;
    const isRemoving = removingAddress === item.address;
    const isBusy = isConnecting || isDisconnecting || isRemoving;
    return (
      <TouchableOpacity
        activeOpacity={0.9}
        onLongPress={() => handleRemovePairedDevice(item)}
        delayLongPress={500}
        style={[styles.deviceRow, item.connected && styles.deviceRowConnected]}
      >
        <View style={styles.deviceInfo}>
          <Text style={styles.deviceName} numberOfLines={1}>
            {item.name}
          </Text>
          <Text style={styles.deviceAddress}>{item.address}</Text>
        </View>
        <View style={styles.deviceActions}>
          <Text
            style={[
              styles.deviceStatus,
              item.connected && styles.deviceStatusConnected,
            ]}
          >
            {item.connected ? '● Connected' : '○ Paired'}
          </Text>
          <TouchableOpacity
            style={[
              styles.deviceActionBtn,
              isBusy && styles.deviceActionBtnDisabled,
            ]}
            onPress={() =>
              item.connected ? handleDisconnect(item) : handleConnect(item)
            }
            disabled={isBusy || pairingAddress !== null}
          >
            {isBusy ? (
              <ActivityIndicator
                color={RC_THEME.colors.accentBright}
                size="small"
              />
            ) : (
              <Text style={styles.deviceActionBtnText}>
                {item.connected ? 'Disconnect' : 'Connect'}
              </Text>
            )}
          </TouchableOpacity>
          <Text style={styles.deviceHint}>
            {isRemoving ? 'Removing…' : 'Hold to remove'}
          </Text>
        </View>
      </TouchableOpacity>
    );
  };

  const renderDiscoveredDevice = ({ item }: { item: BTDevice }) => {
    const isPairing = pairingAddress === item.address;
    return (
      <TouchableOpacity
        style={styles.deviceRow}
        onPress={() => handlePair(item)}
        disabled={isPairing || pairingAddress !== null}
      >
        <View style={styles.deviceInfo}>
          <Text style={styles.deviceName} numberOfLines={1}>
            {item.name}
          </Text>
          <Text style={styles.deviceAddress}>
            {item.address}
            {'  '}
            {rssiToSignal(item.rssi)}
          </Text>
        </View>
        {isPairing ? (
          <ActivityIndicator
            color={RC_THEME.colors.accentBright}
            size="small"
          />
        ) : (
          <Text style={styles.pairBtn}>Pair ›</Text>
        )}
      </TouchableOpacity>
    );
  };

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
        <View style={styles.header}>
          <View style={styles.headerTitleRow}>
            <MaterialCommunityIcons
              name="bluetooth"
              size={25}
              color={RC_THEME.colors.accentBright}
            />
            <View>
              <Text style={styles.headerEyebrow}>RELIC COMMANDER</Text>
              <Text style={styles.headerTitle}>Bluetooth control</Text>
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

        {/* Bluetooth not supported */}
        {btInfo?.supported === false && (
          <Text style={styles.unsupportedText}>
            Bluetooth is not available on this device.
          </Text>
        )}

        {btInfo?.supported !== false && (
          <>
            {/* Toggle row */}
            <View style={styles.toggleRow}>
              <Text style={styles.toggleLabel}>Bluetooth</Text>
              {togglingBt ? (
                <ActivityIndicator color={RC_THEME.colors.accentBright} />
              ) : (
                <Switch
                  value={btInfo?.isEnabled ?? false}
                  onValueChange={handleToggleBt}
                  trackColor={{
                    false: RC_THEME.colors.surfaceElevated,
                    true: RC_THEME.colors.primary,
                  }}
                  thumbColor={
                    btInfo?.isEnabled
                      ? RC_THEME.colors.accentBright
                      : RC_THEME.colors.textMuted
                  }
                />
              )}
            </View>

            {btInfo?.isEnabled && (
              <FlatList
                data={[]}
                keyExtractor={() => 'static'}
                renderItem={null}
                ListHeaderComponent={
                  <>
                    {/* Paired devices */}
                    {(btInfo?.bondedDevices?.length ?? 0) > 0 && (
                      <>
                        <Text style={styles.sectionTitle}>Paired Devices</Text>
                        {btInfo!.bondedDevices.map(d => (
                          <View key={d.address}>
                            {renderBondedDevice({ item: d })}
                          </View>
                        ))}
                      </>
                    )}

                    {/* Scan button */}
                    <TouchableOpacity
                      style={[
                        styles.scanBtn,
                        discovering && styles.scanBtnDisabled,
                      ]}
                      onPress={handleScan}
                      disabled={discovering}
                    >
                      {discovering ? (
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
                          <Text style={styles.scanBtnText}>
                            Scan for devices
                          </Text>
                        </View>
                      )}
                    </TouchableOpacity>

                    {/* Discovered devices */}
                    {discoveredDevices.length > 0 && (
                      <Text style={styles.sectionTitle}>Available Devices</Text>
                    )}
                  </>
                }
                ListFooterComponent={
                  <>
                    {discoveredDevices.map(d => (
                      <View key={d.address}>
                        {renderDiscoveredDevice({ item: d })}
                      </View>
                    ))}
                    {discovering && discoveredDevices.length === 0 && (
                      <Text style={styles.scanningText}>Scanning…</Text>
                    )}
                    {!discovering && discoveredDevices.length === 0 && (
                      <Text style={styles.emptyText}>
                        Tap "Scan" to find nearby devices
                      </Text>
                    )}
                  </>
                }
                contentContainerStyle={styles.listContent}
              />
            )}

            {!btInfo?.isEnabled && (
              <Text style={styles.disabledText}>
                Turn on Bluetooth to see paired and nearby devices.
              </Text>
            )}
          </>
        )}
      </View>
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
  },
  toggleLabel: {
    fontSize: 18,
    fontWeight: '700',
    color: RC_THEME.colors.textSection,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: RC_THEME.colors.textSection,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 6,
  },
  scanBtn: {
    backgroundColor: RC_THEME.colors.primaryPressed,
    marginHorizontal: 16,
    marginTop: 12,
    marginBottom: 4,
    paddingVertical: 14,
    borderWidth: 1,
    borderColor: RC_THEME.colors.primary,
    borderRadius: RC_THEME.radius.small,
    alignItems: 'center',
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
    paddingBottom: 24,
  },
  deviceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: RC_THEME.colors.surface,
    borderWidth: 1,
    borderColor: RC_THEME.colors.border,
    borderRadius: RC_THEME.radius.medium,
    marginHorizontal: 16,
    marginBottom: 8,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  deviceRowConnected: {
    borderColor: RC_THEME.colors.primary,
    backgroundColor: RC_THEME.colors.surfaceAccent,
    ...RC_THEME.shadow.glow,
  },
  deviceInfo: {
    flex: 1,
  },
  deviceName: {
    fontSize: 16,
    fontWeight: '600',
    color: RC_THEME.colors.textPrimary,
  },
  deviceAddress: {
    fontSize: 12,
    color: RC_THEME.colors.textMuted,
    marginTop: 2,
    fontFamily: 'monospace',
  },
  deviceStatus: {
    fontSize: 13,
    color: RC_THEME.colors.textMuted,
    fontWeight: '600',
  },
  deviceStatusConnected: {
    color: RC_THEME.colors.accentBright,
  },
  deviceActions: {
    alignItems: 'flex-end',
    marginLeft: 12,
  },
  deviceActionBtn: {
    minWidth: 96,
    minHeight: 34,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: RC_THEME.colors.primary,
    borderRadius: RC_THEME.radius.small,
    marginTop: 6,
    paddingHorizontal: 10,
  },
  deviceActionBtnDisabled: {
    opacity: 0.6,
  },
  deviceActionBtnText: {
    fontSize: 13,
    color: RC_THEME.colors.accentInfo,
    fontWeight: '700',
  },
  deviceHint: {
    fontSize: 11,
    color: RC_THEME.colors.textMuted,
    marginTop: 6,
  },
  pairBtn: {
    fontSize: 15,
    color: RC_THEME.colors.accentBright,
    fontWeight: '700',
  },
  scanningText: {
    textAlign: 'center',
    color: RC_THEME.colors.textSecondary,
    marginTop: 24,
    fontSize: 15,
  },
  emptyText: {
    textAlign: 'center',
    color: RC_THEME.colors.textMuted,
    marginTop: 32,
    fontSize: 15,
    paddingHorizontal: 16,
  },
  disabledText: {
    textAlign: 'center',
    color: RC_THEME.colors.textMuted,
    marginTop: 60,
    fontSize: 16,
    paddingHorizontal: 40,
  },
  unsupportedText: {
    textAlign: 'center',
    color: RC_THEME.colors.danger,
    marginTop: 60,
    fontSize: 16,
    paddingHorizontal: 40,
  },
});
