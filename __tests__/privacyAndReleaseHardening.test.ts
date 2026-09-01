import { FORK_CAPABILITIES } from '../src/config/forkCapabilities';

declare const __dirname: string;

const fs = jest.requireActual('fs') as {
  readFileSync(path: string, encoding: string): string;
  existsSync(path: string): boolean;
};
const path = jest.requireActual('path') as {
  resolve(...paths: string[]): string;
};

const readProjectFile = (relativePath: string): string =>
  fs.readFileSync(path.resolve(__dirname, '..', relativePath), 'utf8');

describe('RC-FreeKiosk privacy profile', () => {
  it('keeps capture and location telemetry capabilities disabled', () => {
    expect(FORK_CAPABILITIES).toEqual({
      cameraCapture: false,
      microphoneCapture: false,
      locationTelemetry: false,
    });
  });

  it('does not request camera or microphone permissions', () => {
    const manifest = readProjectFile(
      'android/app/src/main/AndroidManifest.xml',
    );

    expect(manifest).not.toContain('android.permission.CAMERA');
    expect(manifest).not.toContain('android.permission.RECORD_AUDIO');
  });

  it('denies capture and geolocation to web content', () => {
    const webView = readProjectFile('src/components/WebViewComponent.tsx');
    const webViewPatch = readProjectFile(
      'patches/react-native-webview+13.16.0.patch',
    );

    expect(webView).toContain('mediaCapturePermissionGrantType="deny"');
    expect(webViewPatch).toContain('request.deny();');
    expect(webViewPatch).toContain('callback.invoke(origin, false, false);');
  });

  it('does not expose legacy location or capture endpoints', () => {
    const server = readProjectFile(
      'android/app/src/main/java/com/freekiosk/api/KioskHttpServer.kt',
    );

    expect(server).not.toContain('"/api/location"');
    expect(server).not.toContain('"/api/screenshot"');
    expect(server).not.toContain('"/api/camera/');
  });

  it('disables Bluetooth only for fresh Device Owner installations', () => {
    const bluetoothDefault = readProjectFile(
      'android/app/src/main/java/com/freekiosk/BluetoothInstallDefault.kt',
    );
    const activity = readProjectFile(
      'android/app/src/main/java/com/freekiosk/MainActivity.kt',
    );

    expect(bluetoothDefault).toContain(
      'packageInfo.firstInstallTime == packageInfo.lastUpdateTime',
    );
    expect(bluetoothDefault).toContain(
      'dpm.isDeviceOwnerApp(appContext.packageName)',
    );
    expect(bluetoothDefault).toContain('Manifest.permission.BLUETOOTH_CONNECT');
    expect(bluetoothDefault).toContain('val accepted = adapter.disable()');
    expect(bluetoothDefault).toContain('putBoolean(KEY_EVALUATED, true)');
    expect(activity).toContain(
      'BluetoothInstallDefault.applyIfEligible(applicationContext)',
    );
    expect(activity.indexOf('requestBluetoothPermissions()')).toBeLessThan(
      activity.indexOf(
        'BluetoothInstallDefault.applyIfEligible(applicationContext)',
      ),
    );
  });
});

describe('RC-FreeKiosk release pipeline', () => {
  it('uses the fork Releases for self-updates', () => {
    const updater = readProjectFile(
      'android/app/src/main/java/com/freekiosk/UpdateModule.kt',
    );
    const settings = readProjectFile(
      'src/screens/settings/SettingsScreenNew.tsx',
    );

    expect(updater).toContain('Belarrius1/rc-freekiosk/releases');
    expect(updater).not.toContain('rushb-fr/freekiosk/releases');
    expect(settings).toContain('isLegacyForkBuild');
  });

  it('is manual, requires release signing and creates no Actions artifact', () => {
    const workflow = readProjectFile('.github/workflows/build-release-apk.yml');

    expect(workflow).toContain('workflow_dispatch:');
    expect(workflow).not.toMatch(/^\s+(push|pull_request|schedule):/m);
    expect(workflow).toContain('Release signing is mandatory');
    expect(workflow).toContain('RC_FREEKIOSK_KEYSTORE_BASE64');
    expect(workflow).toContain('RC_VERSION_NAME:');
    expect(workflow).toContain('RC_VERSION_CODE:');
    expect(workflow).toContain('example: v0.9 or v1.0.0');
    expect(workflow).not.toContain('actions/upload-artifact');
    expect(workflow).toContain('gh release upload');
    expect(workflow).toContain('gh release create');
  });

  it('keeps the documentation-to-Wiki synchronization manual', () => {
    const workflow = readProjectFile('.github/workflows/docs-to-wiki-sync.yml');

    expect(workflow).toContain('workflow_dispatch:');
    expect(workflow).not.toMatch(/^\s+(push|pull_request|schedule):/m);
  });
});

describe('RC Terminal Android wallpaper', () => {
  it('packages and applies the local wallpaper without keeping upstream agent instructions', () => {
    const manifest = readProjectFile(
      'android/app/src/main/AndroidManifest.xml',
    );
    const gradle = readProjectFile('android/app/build.gradle');
    const activity = readProjectFile(
      'android/app/src/main/java/com/freekiosk/MainActivity.kt',
    );
    const installer = readProjectFile(
      'android/app/src/main/java/com/freekiosk/RcWallpaperInstaller.kt',
    );

    expect(manifest).toContain('android.permission.SET_WALLPAPER');
    expect(gradle).toContain("assets.srcDir rootProject.file('../img')");
    expect(activity).toContain('RcWallpaperInstaller.applyIfChanged');
    expect(installer).toContain('rc-terminal-wallpaper.png');
    expect(installer).toContain('WallpaperManager.FLAG_SYSTEM');
    expect(installer).toContain('WallpaperManager.FLAG_LOCK');
    expect(installer).toContain('system-and-lock-v2');
    expect(
      fs.existsSync(
        path.resolve(__dirname, '..', 'img/rc-terminal-wallpaper.png'),
      ),
    ).toBe(true);
    expect(fs.existsSync(path.resolve(__dirname, '..', 'CLAUDE.md'))).toBe(
      false,
    );
  });
});

describe('RC Terminal tablet layout', () => {
  it('provides dedicated landscape layouts for customer and admin screens', () => {
    const quickSettings = readProjectFile(
      'src/components/KioskQuickSettingsDialog.tsx',
    );
    const nativeUpdater = readProjectFile(
      'android/app/src/main/java/com/freekiosk/UpdateModule.kt',
    );
    const nativeSystemInfo = readProjectFile(
      'android/app/src/main/java/com/freekiosk/SystemInfoModule.kt',
    );
    const webView = readProjectFile('src/components/WebViewComponent.tsx');
    const screenTimeout = readProjectFile(
      'src/components/ScreenTimeoutDialog.tsx',
    );
    const nativeScreenTimeout = readProjectFile(
      'android/app/src/main/java/com/freekiosk/ScreenTimeoutModule.kt',
    );
    const mainApplication = readProjectFile(
      'android/app/src/main/java/com/freekiosk/MainApplication.kt',
    );
    const wifi = readProjectFile('src/components/WifiDialog.tsx');
    const bluetooth = readProjectFile('src/components/BluetoothDialog.tsx');
    const pin = readProjectFile('src/components/PinInput.tsx');

    expect(quickSettings).toContain('dialogBodyLandscape');
    expect(quickSettings).toContain('RELIC COMMANDER TERMINAL -');
    expect(quickSettings).toContain('<Text style={styles.title}>Menu</Text>');
    expect(quickSettings).toContain('Check for updates');
    expect(quickSettings).toContain('handleCheckForUpdates();');
    expect(quickSettings).toContain('updateCheckInFlightRef');
    expect(quickSettings).toContain('styles.updateVersionsInline');
    expect(quickSettings).toContain('>Installed </Text>');
    expect(quickSettings).toContain('>Available </Text>');
    expect(quickSettings).toContain('isBatterySafeForPublicUpdate');
    expect(quickSettings).toContain('updateBatteryTooLow');
    expect(quickSettings).toContain('disabled={updateActionDisabled}');
    expect(quickSettings).toContain('to check for updates. Current level:');
    expect(quickSettings).toContain('KioskModule.isDeviceOwner()');
    expect(quickSettings).toContain('isTrustedRcUpdateUrl');
    expect(quickSettings).toContain('downloadAndInstallSilently');
    expect(quickSettings).toContain("'wifi-strength-4'");
    expect(quickSettings).toContain('minHeight: 76');
    expect(nativeSystemInfo).toContain('transportWifiInfo');
    expect(nativeSystemInfo).toContain('connectionWifiInfo');
    expect(nativeSystemInfo).toContain('hasUsableSsid');
    expect(quickSettings).not.toContain('openInstallPermissionSettings');
    expect(nativeUpdater).toContain('fun downloadAndInstallSilently');
    expect(nativeUpdater).toContain('hasSafeBatteryForPublicUpdate');
    expect(nativeUpdater).toContain('MIN_PUBLIC_UPDATE_BATTERY_PERCENT = 50');
    expect(nativeUpdater).toContain('if (silentOnly)');
    expect(nativeUpdater).toContain('refusing to open system installation UI');
    expect(webView).toContain('errorCardLandscape');
    expect(webView).toMatch(
      /webview:\s*\{[^}]*backgroundColor: '#000'/,
    );
    expect(quickSettings).toContain("{ key: 'sleep', label: 'Screen sleep'");
    expect(quickSettings).toContain('FlashlightModule.setEnabled');
    expect(quickSettings).toContain('styles.settingButtonLandscape');
    expect(quickSettings).toContain('maxWidth: 1080');
    expect(screenTimeout).toContain("{ label: '30 sec', value: 30_000 }");
    expect(screenTimeout).toContain("{ label: 'Disabled', value: 0 }");
    expect(screenTimeout).toContain("{ label: '10 min', value: 600_000 }");
    expect(screenTimeout).toContain('KioskModule.setKeepScreenOn(true)');
    expect(screenTimeout).toContain('StorageService.saveKeepScreenOn(true)');
    expect(screenTimeout).toContain('KioskModule.setKeepScreenOn(false)');
    expect(nativeScreenTimeout).toContain('Settings.System.SCREEN_OFF_TIMEOUT');
    expect(nativeScreenTimeout).toContain('ALLOWED_TIMEOUTS_MS');
    expect(nativeScreenTimeout).toContain(
      'devicePolicyManager.setSystemSetting(',
    );
    expect(nativeScreenTimeout).toContain(
      'devicePolicyManager.isDeviceOwnerApp(reactContext.packageName)',
    );
    expect(nativeScreenTimeout).toContain(
      'Build.VERSION.SDK_INT < Build.VERSION_CODES.P',
    );
    expect(nativeScreenTimeout).not.toContain('ACTION_SETTINGS');
    expect(mainApplication).toContain('add(ScreenTimeoutPackage())');
    expect(wifi).toContain('headerLandscape');
    expect(bluetooth).toContain('headerLandscape');
    expect(pin).toContain('primaryContentLandscape');
    expect(pin).toContain('quickBtnLandscape');
  });

  it('disables user zoom natively without rewriting the website viewport', () => {
    const webView = readProjectFile('src/components/WebViewComponent.tsx');
    const manifest = readProjectFile(
      'android/app/src/main/AndroidManifest.xml',
    );

    expect(webView).toContain('setBuiltInZoomControls={!disableUserZoom}');
    expect(webView).not.toContain('scalesPageToFit=');
    expect(webView).not.toContain('textZoom=');
    expect(webView).not.toContain('document.documentElement.style.zoom');
    expect(webView).not.toContain('document.body.style.zoom');
    expect(webView).not.toContain(
      "vp.setAttribute('content', 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no')",
    );
    expect(manifest).toContain('android:hardwareAccelerated="true"');
  });

  it('keeps links and window.open inside a single native WebView', () => {
    const webView = readProjectFile('src/components/WebViewComponent.tsx');

    expect(webView).toContain('setSupportMultipleWindows={false}');
    expect(webView).toContain("originWhitelist={['*']}");
    expect(webView).not.toContain('onOpenWindow=');
  });

  it('keeps the RC music player persistent, autoplay-capable and single-window', () => {
    const player = readProjectFile(
      'src/components/RelicCommanderMusicPlayer.tsx',
    );
    const playerApi = readProjectFile('src/utils/rcMusicPlayerApi.ts');
    const kiosk = readProjectFile('src/screens/KioskScreen.tsx');
    const batteryWarning = readProjectFile(
      'src/components/KioskBatteryWarning.tsx',
    );
    const terminalLogin = readProjectFile(
      'src/components/RcTerminalLoginDialog.tsx',
    );
    const wifiControl = readProjectFile(
      'android/app/src/main/java/com/freekiosk/WifiControlModule.kt',
    );

    expect(player).toContain('RC_TERMINAL_MUSIC_PLAYER');
    expect(player).toContain('mediaPlaybackRequiresUserAction={false}');
    expect(player).toContain('setSupportMultipleWindows={false}');
    expect(player).toContain('thirdPartyCookiesEnabled');
    expect(player).toContain("originWhitelist={['*']}");
    expect(player).toContain('onNavigationStateChange=');
    expect(player).toContain('webViewGeneration');
    expect(player).toContain('isRcMusicPlayerNavigationAllowed');
    expect(player).toContain('window.RCMusicPlayer');
    expect(player).toContain('rc-music-player-api-ready');
    expect(playerApi).toContain('RC_MUSIC_PLAYER_STATE');
    expect(playerApi).toContain(
      'payload.protocol !== RC_MUSIC_PLAYER_PROTOCOL',
    );
    expect(player).toContain('parseRcMusicPlayerStateMessage');
    expect(player).toContain("runPlayerCommand('toggle')");
    expect(player).toContain("runPlayerCommand('next')");
    expect(player).toContain("runPlayerCommand('previous')");
    expect(player).toContain('seekTo(');
    expect(player).toContain('__rcKioskToggleMusicMuted');
    expect(kiosk).toContain('musicPlayerInitialized &&');
    expect(kiosk).toContain('setMusicPlayerInitialized(true)');
    expect(kiosk).toContain('MUSIC_IDLE_UNMOUNT_DELAY_MS = 10_000');
    expect(kiosk).toContain('setMusicPlayerInitialized(false)');
    expect(kiosk).toContain('handleOpenMusicPlayer');
    expect(kiosk).toContain('handleCloseMusicPlayer');
    expect(kiosk).toContain('kiosk-music-toggle-button');
    expect(kiosk).toContain('handleToggleMusicPlayback');
    expect(kiosk).toContain('musicPlayerRef.current?.toggle()');
    expect(player).toContain('Hide the music icon');
    expect(player).toContain('onHideMusicIconChange');
    expect(kiosk).toContain('StorageService.saveHideMusicIcon(hidden)');
    expect(kiosk).toContain('!hideMusicIcon &&');
    expect(kiosk).toContain('musicPlaybackState.available &&');
    expect(kiosk).toContain('musicPlaybackState.ready &&');
    expect(kiosk).toContain('styles.kioskMusicButtonRightEdge');
    expect(kiosk).toContain('styles.kioskSettingsButtonRightEdge');
    expect(kiosk).toContain('name="menu"');
    expect(kiosk).toContain('kiosk-terminal-login-button');
    expect(kiosk).toContain('!terminalSessionActive &&');
    expect(kiosk).toContain('name="key-variant"');
    expect(terminalLogin).toContain('KioskModule.showKeyboard(tag)');
    expect(terminalLogin).toContain('showSoftInputOnFocus');
    expect(terminalLogin).toContain('const timers = [250, 700]');
    expect(terminalLogin).toContain('returnKeyType="done"');
    expect(terminalLogin).toContain('WIFI_LOGIN_WAIT_TIMEOUT_MS = 15_000');
    expect(terminalLogin).toContain('info?.isConnected && info?.hasInternet');
    expect(terminalLogin).toContain('pendingPinRef.current = null');
    expect(wifiControl).toContain(
      'NetworkCapabilities.NET_CAPABILITY_VALIDATED',
    );
    expect(wifiControl).toContain(
      'result.putBoolean("hasInternet", hasInternet)',
    );
    expect(kiosk).toContain("top: '50%'");
    expect(kiosk).toContain('right: publicControlsRight');
    expect(kiosk).toContain('<KioskBatteryWarning');
    expect(batteryWarning).toContain(
      'BATTERY_BANNER_DURATION_MS = 10_000',
    );
    expect(batteryWarning).toContain(
      "name={banner.critical ? 'battery-outline' : 'battery-20'}",
    );
    expect(batteryWarning).toContain('transform: [{ translateY: 34 }]');
    expect(batteryWarning).toContain('Animated.loop(');
    expect(batteryWarning).toContain('battery.level <= 5');
    expect(batteryWarning).not.toContain('battery.level <= 10');
    expect(batteryWarning).toContain('pointerEvents="none"');
    expect(kiosk).not.toContain(
      '{ top: settingsButtonTop, right: settingsButtonRight }',
    );
    expect(kiosk).toContain(
      'hitSlop={{ top: 12, right: 12, bottom: 12, left: 12 }}',
    );
  });
});

describe('RC Terminal quick login hardening', () => {
  it('keeps the P-256 private key non-exportable in Android Keystore', () => {
    const nativeAuth = readProjectFile(
      'android/app/src/main/java/com/freekiosk/RcTerminalAuthModule.kt',
    );

    expect(nativeAuth).toContain('AndroidKeyStore');
    expect(nativeAuth).toContain('ECGenParameterSpec("secp256r1")');
    expect(nativeAuth).toContain('SHA256withECDSA');
    expect(nativeAuth).toContain('verifiedPublicKey.encoded');
    expect(nativeAuth).not.toContain('privateKey.encoded');
    expect(nativeAuth).not.toContain('react-native-keychain');
  });

  it('hands the one-use ticket to the main WebView with native POST only', () => {
    const nativeKiosk = readProjectFile(
      'android/app/src/main/java/com/freekiosk/KioskModule.kt',
    );
    const webView = readProjectFile('src/components/WebViewComponent.tsx');

    expect(nativeKiosk).toContain(
      'webView.postUrl("https://reliccommander.com/terminal/session", postBody)',
    );
    expect(nativeKiosk).toContain('ReactFindViewUtil.findView(');
    expect(nativeKiosk).toContain('relicCommanderWebViewNativeId');
    expect(nativeKiosk).toContain('getUIManagerForReactTag');
    expect(nativeKiosk).toContain('fun showKeyboard(tag: Int, promise: Promise)');
    expect(nativeKiosk).toContain('imm.restartInput(inputView)');
    expect(nativeKiosk).toContain('imm.showSoftInput(inputView');
    expect(nativeKiosk).toContain('longArrayOf(0L, 150L, 400L)');
    expect(nativeKiosk).not.toContain('UIManagerType.FABRIC');
    expect(nativeKiosk).toContain('body?.fill(0)');
    expect(webView).toContain('nativeID="rc-main-webview"');
    expect(webView).toContain('collapsable={false}');
    expect(webView).toContain('postRcTerminalSession');
    expect(webView).not.toMatch(/injectJavaScript\([^)]*ticket/s);
  });
});

describe('Kiosk wake-up hardening', () => {
  it('restores immersive mode directly after every screen-on event', () => {
    const activity = readProjectFile(
      'android/app/src/main/java/com/freekiosk/MainActivity.kt',
    );
    const screenReceiver = readProjectFile(
      'android/app/src/main/java/com/freekiosk/ScreenStateReceiver.kt',
    );

    expect(screenReceiver).toContain('onScreenOn?.invoke()');
    expect(activity).toContain('restoreImmersiveModeAfterScreenOn()');
    expect(activity).toContain(
      'longArrayOf(0L, 300L, 1000L, 2000L, 3000L)',
    );
    expect(activity).toContain(
      'private val immersiveRecoveryHandler = Handler(Looper.getMainLooper())',
    );
    expect(activity).toContain('window.decorView.hasWindowFocus()');
    expect(activity).toContain(
      'insets.isVisible(WindowInsetsCompat.Type.navigationBars())',
    );
    expect(activity).toContain(
      'insets.isVisible(WindowInsetsCompat.Type.statusBars())',
    );
    expect(activity).not.toContain('insets.isVisible(WindowInsetsCompat.Type.systemBars())');
    expect(activity).toContain(
      'immersiveRecoveryHandler.removeCallbacksAndMessages(null)',
    );
    expect(activity).toContain('ScreenStateReceiver {');
    expect(activity).toContain('hide(WindowInsets.Type.navigationBars())');
    expect(activity).toContain('View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY');
  });

  it('powers Wi-Fi down during sleep and restores only kiosk-owned state', () => {
    const controller = readProjectFile(
      'android/app/src/main/java/com/freekiosk/SleepWifiController.kt',
    );
    const screenReceiver = readProjectFile(
      'android/app/src/main/java/com/freekiosk/ScreenStateReceiver.kt',
    );
    const overlayService = readProjectFile(
      'android/app/src/main/java/com/freekiosk/OverlayService.kt',
    );
    const bootReceiver = readProjectFile(
      'android/app/src/main/java/com/freekiosk/BootReceiver.kt',
    );
    const activity = readProjectFile(
      'android/app/src/main/java/com/freekiosk/MainActivity.kt',
    );

    expect(controller).toContain('private const val EXPERIMENT_ENABLED = true');
    expect(controller).toContain('PowerManager.PARTIAL_WAKE_LOCK');
    expect(controller).toContain('createDeviceProtectedStorageContext()');
    expect(controller).toContain('putBoolean(KEY_DISABLED_FOR_SLEEP, true).commit()');
    expect(controller).toContain('wifiManager.setWifiEnabled(false)');
    expect(controller).toContain('wifiManager.setWifiEnabled(true)');
    expect(controller).toContain('dpm.isDeviceOwnerApp(context.packageName)');
    expect(screenReceiver).toContain('SleepWifiController.onScreenOff(context)');
    expect(screenReceiver).toContain('SleepWifiController.onScreenOn(context)');
    expect(overlayService).toContain(
      'SleepWifiController.onScreenOff(this@OverlayService)',
    );
    expect(bootReceiver).toContain('SleepWifiController.restoreAfterBoot(context)');
    expect(activity).toContain(
      'SleepWifiController.restoreIfInteractive(applicationContext)',
    );
  });
});
