import React, { useEffect, useState } from 'react';
import { NativeModules, StyleSheet, Text, View } from 'react-native';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import BrightnessModule from '../utils/BrightnessModule';
import { RC_THEME } from '../theme/relicCommanderTheme';

const { SystemInfoModule } = NativeModules;

interface Props {
  top: number;
  right: number;
}

interface TerminalStatus {
  batteryLevel: number | null;
  isCharging: boolean;
  wifiConnected: boolean;
  wifiSignalLevel: number | null;
  brightness: number | null;
}

const EMPTY_STATUS: TerminalStatus = {
  batteryLevel: null,
  isCharging: false,
  wifiConnected: false,
  wifiSignalLevel: null,
  brightness: null,
};

function batteryIcon(level: number | null, charging: boolean): string {
  if (charging) return 'battery-charging';
  if (level === null) return 'battery-unknown';
  if (level <= 10) return 'battery-alert';
  if (level <= 25) return 'battery-20';
  if (level <= 50) return 'battery-50';
  if (level <= 75) return 'battery-80';
  return 'battery';
}

function wifiIcon(connected: boolean, signalLevel: number | null): string {
  if (!connected) return 'wifi-strength-off-outline';
  if (signalLevel === null) return 'wifi';
  return [
    'wifi-strength-outline',
    'wifi-strength-1',
    'wifi-strength-2',
    'wifi-strength-3',
    'wifi-strength-4',
  ][signalLevel];
}

export default function KioskTerminalStatusIcons({ top, right }: Props) {
  const [status, setStatus] = useState<TerminalStatus>(EMPTY_STATUS);

  useEffect(() => {
    let active = true;

    const refresh = async (): Promise<void> => {
      try {
        const info = await SystemInfoModule?.getSystemInfo?.();
        if (active && info) {
          const batteryLevel =
            typeof info.battery?.level === 'number' &&
            info.battery.level >= 0 &&
            info.battery.level <= 100
              ? Math.round(info.battery.level)
              : null;
          const wifiSignalLevel =
            typeof info.wifi?.signalLevel === 'number' &&
            info.wifi.signalLevel >= 0 &&
            info.wifi.signalLevel <= 4
              ? Math.round(info.wifi.signalLevel)
              : null;
          setStatus(current => ({
            ...current,
            batteryLevel,
            isCharging: Boolean(info.battery?.isCharging),
            wifiConnected: Boolean(info.wifi?.isConnected),
            wifiSignalLevel,
          }));
        }
      } catch (error) {
        console.warn('[TerminalStatusIcons] system status error:', error);
      }

      try {
        const brightness = await BrightnessModule.getBrightnessLevel();
        if (active) {
          setStatus(current => ({ ...current, brightness }));
        }
      } catch (error) {
        console.warn('[TerminalStatusIcons] brightness status error:', error);
      }
    };

    refresh();
    const interval = setInterval(refresh, 5000);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, []);

  const batteryLabel =
    status.batteryLevel === null ? '--' : `${status.batteryLevel}%`;
  const brightnessLabel =
    status.brightness === null
      ? '--'
      : `${Math.round(status.brightness * 100)}%`;

  return (
    <View
      pointerEvents="none"
      accessible
      accessibilityLabel={`Terminal status. Battery ${batteryLabel}. Wi-Fi ${
        status.wifiConnected ? 'connected' : 'offline'
      }. Brightness ${brightnessLabel}.`}
      style={[styles.container, { top, right }]}
    >
      <View style={styles.item}>
        <MaterialCommunityIcons
          name={batteryIcon(status.batteryLevel, status.isCharging)}
          size={18}
          color={
            status.batteryLevel !== null && status.batteryLevel < 25
              ? RC_THEME.colors.warning
              : RC_THEME.colors.accentBright
          }
        />
        <Text style={styles.value}>{batteryLabel}</Text>
      </View>

      <View style={styles.item}>
        <MaterialCommunityIcons
          name={wifiIcon(status.wifiConnected, status.wifiSignalLevel)}
          size={19}
          color={
            status.wifiConnected
              ? RC_THEME.colors.success
              : RC_THEME.colors.danger
          }
        />
      </View>

      <View style={styles.item}>
        <MaterialCommunityIcons
          name="brightness-6"
          size={18}
          color={RC_THEME.colors.accentBright}
        />
        <Text style={styles.value}>{brightnessLabel}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    minHeight: 38,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 11,
    paddingVertical: 7,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: RC_THEME.colors.borderStrong,
    borderRadius: RC_THEME.radius.pill,
    backgroundColor: 'rgba(11, 19, 30, 0.84)',
    elevation: 8,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.28,
    shadowRadius: 3,
    zIndex: 1090,
  },
  item: {
    minHeight: 22,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  value: {
    color: RC_THEME.colors.textPrimary,
    fontSize: 12,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
});
