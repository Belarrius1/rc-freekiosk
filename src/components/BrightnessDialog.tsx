import React, { useEffect, useRef, useState } from 'react';
import { Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Slider from '@react-native-community/slider';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import BrightnessModule from '../utils/BrightnessModule';
import { StorageService } from '../utils/storage';
import { RC_THEME } from '../theme/relicCommanderTheme';

interface Props {
  visible: boolean;
  onClose: () => void;
}

export default function BrightnessDialog({ visible, onClose }: Props) {
  const [brightness, setBrightness] = useState(0.5);
  const lastPersisted = useRef(0.5);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    (async () => {
      try {
        const current = await BrightnessModule.getBrightnessLevel();
        if (!cancelled) {
          setBrightness(current);
          lastPersisted.current = current;
        }
      } catch (e) {
        console.warn('[BrightnessDialog] getBrightnessLevel error:', e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [visible]);

  const applyBrightness = async (value: number) => {
    setBrightness(value);
    try {
      await BrightnessModule.setBrightnessLevel(value);
    } catch (e) {
      console.warn('[BrightnessDialog] setBrightnessLevel error:', e);
    }
  };

  const persistBrightness = async (value: number) => {
    if (Math.abs(value - lastPersisted.current) < 0.01) return;
    lastPersisted.current = value;
    try {
      await StorageService.saveDefaultBrightness(value);
    } catch (e) {
      console.warn('[BrightnessDialog] saveDefaultBrightness error:', e);
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
            <View>
              <Text style={styles.eyebrow}>RELIC COMMANDER</Text>
              <Text style={styles.title}>Screen brightness</Text>
            </View>
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel="Close brightness controls"
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
          <Text style={styles.value}>{Math.round(brightness * 100)}%</Text>

          <Slider
            value={brightness}
            minimumValue={0.05}
            maximumValue={1}
            step={0.01}
            minimumTrackTintColor={RC_THEME.colors.primary}
            maximumTrackTintColor={RC_THEME.colors.surfaceElevated}
            thumbTintColor={RC_THEME.colors.accentBright}
            onValueChange={applyBrightness}
            onSlidingComplete={persistBrightness}
          />

          <View style={styles.presets}>
            {[0.2, 0.5, 0.8, 1].map(preset => (
              <TouchableOpacity
                key={preset}
                style={[
                  styles.presetBtn,
                  Math.abs(brightness - preset) < 0.02 &&
                    styles.presetBtnActive,
                ]}
                onPress={async () => {
                  await applyBrightness(preset);
                  await persistBrightness(preset);
                }}
              >
                <Text
                  style={[
                    styles.presetText,
                    Math.abs(brightness - preset) < 0.02 &&
                      styles.presetTextActive,
                  ]}
                >
                  {Math.round(preset * 100)}%
                </Text>
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
    backgroundColor: RC_THEME.colors.overlay,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  card: {
    width: '100%',
    maxWidth: 360,
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
    marginBottom: 8,
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
  value: {
    color: RC_THEME.colors.accentBright,
    fontSize: 30,
    fontWeight: '700',
    marginBottom: 12,
    textAlign: 'center',
    textShadowColor: RC_THEME.colors.primaryGlow,
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 10,
  },
  presets: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 12,
    gap: 8,
  },
  presetBtn: {
    flex: 1,
    minHeight: 40,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: RC_THEME.colors.surface,
    borderRadius: RC_THEME.radius.small,
    borderWidth: 1,
    borderColor: RC_THEME.colors.border,
  },
  presetBtnActive: {
    borderColor: RC_THEME.colors.primary,
    backgroundColor: RC_THEME.colors.surfaceAccent,
    ...RC_THEME.shadow.glow,
  },
  presetText: {
    color: RC_THEME.colors.textMuted,
    fontSize: 13,
    fontWeight: '700',
  },
  presetTextActive: {
    color: RC_THEME.colors.accentBright,
  },
});
