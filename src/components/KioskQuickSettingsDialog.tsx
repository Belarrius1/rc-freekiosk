import React from 'react';
import {
  Image,
  Modal,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import { RC_THEME } from '../theme/relicCommanderTheme';

export type KioskQuickSetting = 'wifi' | 'audio' | 'brightness' | 'bluetooth';

interface Props {
  visible: boolean;
  onClose: () => void;
  onSelect: (setting: KioskQuickSetting) => void;
}

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
}: Props) {
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

          <Image
            accessibilityLabel="Relic Commander Terminal"
            source={require('../../img/rc-terminal.png')}
            resizeMode="contain"
            style={styles.terminalLogo}
          />

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
    width: 132,
    height: 132,
    alignSelf: 'center',
    marginTop: -4,
    marginBottom: 16,
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
});
