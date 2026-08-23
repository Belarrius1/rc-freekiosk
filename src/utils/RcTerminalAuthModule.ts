import { NativeModules, Platform } from 'react-native';

interface RcTerminalAuthNativeModule {
  KEY_ALIAS?: string;
  APP_VERSION?: string;
  ensureKey(): Promise<string>;
  hasKey(): Promise<boolean>;
  sign(message: string): Promise<string>;
  deleteKey(): Promise<boolean>;
}

const nativeModule = NativeModules.RcTerminalAuthModule as
  | RcTerminalAuthNativeModule
  | undefined;

const unavailable = (): Error =>
  new Error('Terminal identity is unavailable on this device');

export const RC_TERMINAL_KEY_ALIAS =
  nativeModule?.KEY_ALIAS || 'rc_terminal_login_v1';

export const RC_TERMINAL_APP_VERSION =
  typeof nativeModule?.APP_VERSION === 'string'
    ? nativeModule.APP_VERSION
    : 'unknown';

const RcTerminalAuthModule = {
  ensureKey: (): Promise<string> =>
    Platform.OS === 'android' && nativeModule
      ? nativeModule.ensureKey()
      : Promise.reject(unavailable()),

  hasKey: (): Promise<boolean> =>
    Platform.OS === 'android' && nativeModule
      ? nativeModule.hasKey()
      : Promise.resolve(false),

  sign: (message: string): Promise<string> =>
    Platform.OS === 'android' && nativeModule
      ? nativeModule.sign(message)
      : Promise.reject(unavailable()),

  deleteKey: (): Promise<boolean> =>
    Platform.OS === 'android' && nativeModule
      ? nativeModule.deleteKey()
      : Promise.resolve(false),
};

export default RcTerminalAuthModule;
