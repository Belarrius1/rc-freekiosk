import {
  BATTERY_WARNINGS,
  getBatteryWarning,
} from '../src/utils/batteryWarnings';

describe('battery warnings', () => {
  it('selects the most urgent warning at each threshold', () => {
    expect(getBatteryWarning(26, false)).toBeNull();
    expect(getBatteryWarning(25, false)).toBe(BATTERY_WARNINGS[25]);
    expect(getBatteryWarning(10, false)).toBe(BATTERY_WARNINGS[10]);
    expect(getBatteryWarning(5, false)).toBe(BATTERY_WARNINGS[5]);
    expect(getBatteryWarning(0, false)).toBe(BATTERY_WARNINGS[5]);
  });

  it('does not warn while charging or for invalid battery values', () => {
    expect(getBatteryWarning(5, true)).toBeNull();
    expect(getBatteryWarning(-1, false)).toBeNull();
    expect(getBatteryWarning(101, false)).toBeNull();
    expect(getBatteryWarning(Number.NaN, false)).toBeNull();
  });

  it('uses the requested player-facing messages', () => {
    expect(BATTERY_WARNINGS[25].message).toBe(
      'Low battery! Don’t forget to recharge the Terminal, Commander!',
    );
    expect(BATTERY_WARNINGS[10].message).toBe(
      'Critical battery level! Recharge the Terminal, Commander.',
    );
    expect(BATTERY_WARNINGS[5].message).toBe(
      'Terminal power critically low. Shutdown may occur at any moment.',
    );
  });
});
