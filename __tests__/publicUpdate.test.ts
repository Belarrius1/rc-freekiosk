import {
  compareReleaseVersions,
  isBatterySafeForPublicUpdate,
  isNewerRcRelease,
  isTrustedRcUpdateUrl,
  MIN_PUBLIC_UPDATE_BATTERY_PERCENT,
} from '../src/utils/UpdateModule';

jest.mock('react-native', () => ({
  NativeModules: {
    UpdateModule: { ENABLE_SELF_UPDATE: true },
  },
}));

describe('public RC-FreeKiosk update safeguards', () => {
  it('compares stable and prerelease versions', () => {
    expect(compareReleaseVersions('0.14', '0.13')).toBe(1);
    expect(compareReleaseVersions('v0.13', '0.13.0')).toBe(0);
    expect(compareReleaseVersions('0.14-beta.2', '0.14-beta.1')).toBe(1);
    expect(compareReleaseVersions('0.14-beta.2', '0.14')).toBe(-1);
  });

  it('supports the one-time legacy fork migration', () => {
    expect(
      isNewerRcRelease('0.13', { versionName: '1.2.20', versionCode: 44 }),
    ).toBe(true);
    expect(
      isNewerRcRelease('0.13', { versionName: '0.13', versionCode: 60 }),
    ).toBe(false);
  });

  it('accepts only APK assets from the official GitHub release path', () => {
    expect(
      isTrustedRcUpdateUrl(
        'https://github.com/Belarrius1/rc-freekiosk/releases/download/v0.14/RC-FreeKiosk-v0.14.apk',
      ),
    ).toBe(true);
    expect(
      isTrustedRcUpdateUrl(
        'https://github.com/Belarrius1/rc-freekiosk/releases/download/v0.16/RC-FreeKiosk-v0.16.apk',
      ),
    ).toBe(true);
    expect(
      isTrustedRcUpdateUrl(
        'https://github.com/another/repository/releases/download/v0.14/app.apk',
      ),
    ).toBe(false);
    expect(
      isTrustedRcUpdateUrl(
        'https://github.com/Belarrius1/rc-freekiosk/releases/download/v0.14/update.zip',
      ),
    ).toBe(false);
    expect(isTrustedRcUpdateUrl('http://github.com/fake.apk')).toBe(false);
    expect(
      isTrustedRcUpdateUrl(
        'https://github.com@evil.test/Belarrius1/rc-freekiosk/releases/download/v0.16/app.apk',
      ),
    ).toBe(false);
    expect(
      isTrustedRcUpdateUrl(
        'https://github.com:444/Belarrius1/rc-freekiosk/releases/download/v0.16/app.apk',
      ),
    ).toBe(false);
  });

  it('requires a known battery level of at least 50 percent', () => {
    expect(MIN_PUBLIC_UPDATE_BATTERY_PERCENT).toBe(50);
    expect(isBatterySafeForPublicUpdate(null)).toBe(false);
    expect(isBatterySafeForPublicUpdate(-1)).toBe(false);
    expect(isBatterySafeForPublicUpdate(49)).toBe(false);
    expect(isBatterySafeForPublicUpdate(50)).toBe(true);
    expect(isBatterySafeForPublicUpdate(100)).toBe(true);
    expect(isBatterySafeForPublicUpdate(101)).toBe(false);
  });
});
