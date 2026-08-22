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
    expect(workflow).not.toContain('actions/upload-artifact');
    expect(workflow).toContain('gh release upload');
    expect(workflow).toContain('gh release create');
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
