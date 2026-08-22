import AsyncStorage from '@react-native-async-storage/async-storage';
import { FORK_DEFAULTS } from '../src/config/forkDefaults';
import { StorageService } from '../src/utils/storage';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

beforeEach(async () => {
  await AsyncStorage.clear();
});

describe('Free Kiosk fork defaults', () => {
  it('declares the browser game defaults', () => {
    expect(FORK_DEFAULTS).toEqual({
      reloadOnError: true,
      keepScreenOn: false,
      disableUserZoom: true,
      blockFactoryReset: true,
      defaultLauncher: true,
      restApiAllowControl: false,
    });
  });

  it('uses them when no administrator preference exists', async () => {
    await expect(StorageService.getAutoReload()).resolves.toBe(true);
    await expect(StorageService.getKeepScreenOn()).resolves.toBe(false);
    await expect(StorageService.getDisableUserZoom()).resolves.toBe(true);
    await expect(StorageService.getBlockFactoryReset()).resolves.toBe(true);
    await expect(StorageService.getDefaultLauncher()).resolves.toBe(true);
    await expect(StorageService.getRestApiAllowControl()).resolves.toBe(false);
  });

  it('preserves explicit administrator preferences', async () => {
    await StorageService.saveAutoReload(false);
    await StorageService.saveKeepScreenOn(true);
    await StorageService.saveDisableUserZoom(false);
    await StorageService.saveBlockFactoryReset(false);
    await StorageService.saveDefaultLauncher(false);
    await StorageService.saveRestApiAllowControl(true);

    await expect(StorageService.getAutoReload()).resolves.toBe(false);
    await expect(StorageService.getKeepScreenOn()).resolves.toBe(true);
    await expect(StorageService.getDisableUserZoom()).resolves.toBe(false);
    await expect(StorageService.getBlockFactoryReset()).resolves.toBe(false);
    await expect(StorageService.getDefaultLauncher()).resolves.toBe(false);
    await expect(StorageService.getRestApiAllowControl()).resolves.toBe(true);
  });
});
