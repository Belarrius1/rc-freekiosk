import { NativeModules } from 'react-native';

interface ScreenTimeoutModuleInterface {
  isAvailable(): Promise<boolean>;
  getTimeout(): Promise<number>;
  setTimeout(timeoutMs: number): Promise<number>;
}

const { ScreenTimeoutModule } = NativeModules;

export default ScreenTimeoutModule as ScreenTimeoutModuleInterface;
