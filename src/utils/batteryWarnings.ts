export type BatteryWarningThreshold = 5 | 10 | 25;

export interface BatteryWarning {
  threshold: BatteryWarningThreshold;
  message: string;
  critical: boolean;
}

export const BATTERY_WARNINGS: Record<BatteryWarningThreshold, BatteryWarning> =
  {
    25: {
      threshold: 25,
      message: 'Low battery! Don’t forget to recharge the Terminal, Commander!',
      critical: false,
    },
    10: {
      threshold: 10,
      message: 'Critical battery level! Recharge the Terminal, Commander.',
      critical: true,
    },
    5: {
      threshold: 5,
      message:
        'Terminal power critically low. Shutdown may occur at any moment.',
      critical: true,
    },
  };

/** Returns only the most urgent warning for the current battery state. */
export const getBatteryWarning = (
  level: number,
  isCharging: boolean,
): BatteryWarning | null => {
  if (isCharging || !Number.isFinite(level) || level < 0 || level > 100) {
    return null;
  }

  if (level <= 5) return BATTERY_WARNINGS[5];
  if (level <= 10) return BATTERY_WARNINGS[10];
  if (level <= 25) return BATTERY_WARNINGS[25];
  return null;
};
