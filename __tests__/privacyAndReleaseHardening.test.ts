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
    const webView = readProjectFile('src/components/WebViewComponent.tsx');
    const wifi = readProjectFile('src/components/WifiDialog.tsx');
    const bluetooth = readProjectFile('src/components/BluetoothDialog.tsx');
    const pin = readProjectFile('src/components/PinInput.tsx');

    expect(quickSettings).toContain('dialogBodyLandscape');
    expect(quickSettings).toContain('RELIC COMMANDER TERMINAL -');
    expect(quickSettings).toContain('<Text style={styles.title}>Menu</Text>');
    expect(quickSettings).toContain('Check for updates');
    expect(quickSettings).toContain('isBatterySafeForPublicUpdate');
    expect(quickSettings).toContain('KioskModule.isDeviceOwner()');
    expect(quickSettings).toContain('isTrustedRcUpdateUrl');
    expect(quickSettings).toContain('downloadAndInstallSilently');
    expect(quickSettings).not.toContain('openInstallPermissionSettings');
    expect(nativeUpdater).toContain('fun downloadAndInstallSilently');
    expect(nativeUpdater).toContain('hasSafeBatteryForPublicUpdate');
    expect(nativeUpdater).toContain('MIN_PUBLIC_UPDATE_BATTERY_PERCENT = 50');
    expect(nativeUpdater).toContain('if (silentOnly)');
    expect(nativeUpdater).toContain('refusing to open system installation UI');
    expect(webView).toContain('errorCardLandscape');
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
    expect(kiosk).toContain('musicButtonRight = settingsButtonRight + 46');
  });
});
