import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Animated,
  AppState,
  NativeModules,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { RC_THEME } from '../theme/relicCommanderTheme';
import {
  BatteryWarning,
  BatteryWarningThreshold,
  getBatteryWarning,
} from '../utils/batteryWarnings';

const { SystemInfoModule } = NativeModules;

const BATTERY_POLL_INTERVAL_MS = 15_000;
const BATTERY_BANNER_DURATION_MS = 10_000;
const WARNING_RESET_MARGIN = 2;
const BATTERY_WARNING_THRESHOLDS: BatteryWarningThreshold[] = [5, 10, 25];

interface BatteryState {
  level: number;
  isCharging: boolean;
}

interface KioskBatteryWarningProps {
  enabled: boolean;
  right: number;
}

const KioskBatteryWarning: React.FC<KioskBatteryWarningProps> = ({
  enabled,
  right,
}) => {
  const safeAreaInsets = useSafeAreaInsets();
  const [battery, setBattery] = useState<BatteryState | null>(null);
  const [banner, setBanner] = useState<BatteryWarning | null>(null);
  const shownWarningsRef = useRef<Set<BatteryWarningThreshold>>(new Set());
  const bannerTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const blinkOpacity = useRef(new Animated.Value(1)).current;

  const clearBannerTimer = useCallback(() => {
    if (bannerTimerRef.current) {
      clearTimeout(bannerTimerRef.current);
      bannerTimerRef.current = null;
    }
  }, []);

  const showBanner = useCallback(
    (warning: BatteryWarning) => {
      clearBannerTimer();
      setBanner(warning);
      bannerTimerRef.current = setTimeout(() => {
        setBanner(null);
        bannerTimerRef.current = null;
      }, BATTERY_BANNER_DURATION_MS);
    },
    [clearBannerTimer],
  );

  const refreshBattery = useCallback(async () => {
    try {
      const info = await SystemInfoModule?.getSystemInfo?.();
      const level = info?.battery?.level;
      const isCharging = Boolean(info?.battery?.isCharging);

      if (
        typeof level !== 'number' ||
        !Number.isFinite(level) ||
        level < 0 ||
        level > 100
      ) {
        return;
      }

      setBattery({ level, isCharging });

      BATTERY_WARNING_THRESHOLDS.forEach(threshold => {
        if (level > threshold + WARNING_RESET_MARGIN) {
          shownWarningsRef.current.delete(threshold);
        }
      });

      if (isCharging) {
        clearBannerTimer();
        setBanner(null);
        return;
      }

      const warning = getBatteryWarning(level, false);
      if (warning && !shownWarningsRef.current.has(warning.threshold)) {
        // A device first observed at a critical level must not later display a
        // less urgent warning if Android's battery estimate briefly rises.
        BATTERY_WARNING_THRESHOLDS.filter(
          threshold => threshold >= warning.threshold,
        ).forEach(threshold => shownWarningsRef.current.add(threshold));
        showBanner(warning);
      }
    } catch (error) {
      console.warn('[BatteryWarning] Unable to read battery status:', error);
    }
  }, [clearBannerTimer, showBanner]);

  useEffect(() => {
    if (!enabled) {
      clearBannerTimer();
      setBanner(null);
      return undefined;
    }

    refreshBattery();
    const interval = setInterval(refreshBattery, BATTERY_POLL_INTERVAL_MS);
    const appStateSubscription = AppState.addEventListener(
      'change',
      nextState => {
        if (nextState === 'active') {
          refreshBattery();
        }
      },
    );

    return () => {
      clearInterval(interval);
      appStateSubscription.remove();
    };
  }, [clearBannerTimer, enabled, refreshBattery]);

  useEffect(() => {
    const shouldBlink =
      enabled && battery !== null && !battery.isCharging && battery.level <= 10;

    if (!shouldBlink) {
      blinkOpacity.stopAnimation();
      blinkOpacity.setValue(1);
      return undefined;
    }

    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(blinkOpacity, {
          toValue: 0.3,
          duration: 850,
          useNativeDriver: true,
        }),
        Animated.timing(blinkOpacity, {
          toValue: 1,
          duration: 850,
          useNativeDriver: true,
        }),
      ]),
    );
    animation.start();

    return () => {
      animation.stop();
      blinkOpacity.setValue(1);
    };
  }, [battery, blinkOpacity, enabled]);

  useEffect(
    () => () => {
      clearBannerTimer();
    },
    [clearBannerTimer],
  );

  const warning =
    enabled && battery
      ? getBatteryWarning(battery.level, battery.isCharging)
      : null;

  if (!warning && !banner) return null;

  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {banner && (
        <View
          testID="kiosk-battery-warning-banner"
          accessibilityRole="alert"
          style={[
            styles.banner,
            banner.critical ? styles.bannerCritical : styles.bannerLow,
            { top: Math.max(safeAreaInsets.top, 8) + 8 },
          ]}
        >
          <MaterialCommunityIcons
            name={banner.critical ? 'battery-outline' : 'battery-20'}
            size={28}
            color={
              banner.critical ? RC_THEME.colors.danger : RC_THEME.colors.warning
            }
          />
          <Text style={styles.bannerText}>{banner.message}</Text>
        </View>
      )}

      {warning && battery && (
        <Animated.View
          testID="kiosk-low-battery-indicator"
          accessibilityRole="image"
          accessibilityLabel={`Low battery: ${Math.round(
            battery.level,
          )} percent remaining`}
          style={[
            styles.indicator,
            warning.critical && styles.indicatorCritical,
            { right, opacity: blinkOpacity },
          ]}
        >
          <MaterialCommunityIcons
            name={warning.critical ? 'battery-outline' : 'battery-20'}
            size={25}
            color={
              warning.critical
                ? RC_THEME.colors.danger
                : RC_THEME.colors.warning
            }
          />
        </Animated.View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  banner: {
    position: 'absolute',
    alignSelf: 'center',
    width: '78%',
    maxWidth: 820,
    minHeight: 54,
    paddingHorizontal: 18,
    paddingVertical: 11,
    borderRadius: RC_THEME.radius.medium,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    backgroundColor: RC_THEME.colors.surfaceCardDeep,
    elevation: 12,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 8,
    zIndex: 1200,
  },
  bannerLow: {
    borderColor: RC_THEME.colors.warning,
  },
  bannerCritical: {
    borderColor: RC_THEME.colors.danger,
    backgroundColor: RC_THEME.colors.dangerBackground,
  },
  bannerText: {
    flexShrink: 1,
    color: RC_THEME.colors.textPrimary,
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '700',
    textAlign: 'center',
  },
  indicator: {
    position: 'absolute',
    top: '50%',
    width: 44,
    height: 44,
    transform: [{ translateY: 34 }],
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: RC_THEME.colors.warning,
    backgroundColor: RC_THEME.colors.surfaceCardDeep,
    elevation: 9,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.25,
    shadowRadius: 2,
    zIndex: 1100,
  },
  indicatorCritical: {
    borderColor: RC_THEME.colors.danger,
  },
});

export default KioskBatteryWarning;
