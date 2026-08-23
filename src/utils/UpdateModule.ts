import { NativeModules } from 'react-native';

const { UpdateModule } = NativeModules;

/**
 * Play Store compliance flag.
 * When building with `./gradlew bundleRelease -Pplaystore`, this is false
 * and all update methods become no-ops. The UI hides the update section.
 */
export const ENABLE_SELF_UPDATE: boolean =
  UpdateModule?.ENABLE_SELF_UPDATE ?? true;
export const MIN_PUBLIC_UPDATE_BATTERY_PERCENT = 50;

export interface VersionInfo {
  versionName: string;
  versionCode: number;
}

export interface UpdateInfo {
  version: string;
  name: string;
  notes: string;
  publishedAt: string;
  downloadUrl: string;
  isPrerelease?: boolean;
}

function parseVersion(value: string): {
  core: number[];
  prerelease: Array<string | number>;
} {
  const normalized = value.trim().replace(/^v/i, '').split('+', 1)[0];
  const [coreValue, prereleaseValue = ''] = normalized.split('-', 2);
  const core = coreValue
    .split('.')
    .map(part => (/^\d+$/.test(part) ? Number(part) : 0));
  const prerelease = prereleaseValue
    ? prereleaseValue
        .split('.')
        .map(part => (/^\d+$/.test(part) ? Number(part) : part.toLowerCase()))
    : [];
  return { core, prerelease };
}

/** Semver-style comparison used by the public stable update flow. */
export function compareReleaseVersions(v1: string, v2: string): number {
  const first = parseVersion(v1);
  const second = parseVersion(v2);
  const coreLength = Math.max(first.core.length, second.core.length);

  for (let index = 0; index < coreLength; index += 1) {
    const firstPart = first.core[index] ?? 0;
    const secondPart = second.core[index] ?? 0;
    if (firstPart !== secondPart) return firstPart > secondPart ? 1 : -1;
  }

  if (first.prerelease.length === 0 && second.prerelease.length > 0) return 1;
  if (first.prerelease.length > 0 && second.prerelease.length === 0) return -1;

  const prereleaseLength = Math.max(
    first.prerelease.length,
    second.prerelease.length,
  );
  for (let index = 0; index < prereleaseLength; index += 1) {
    const firstPart = first.prerelease[index];
    const secondPart = second.prerelease[index];
    if (firstPart === undefined) return -1;
    if (secondPart === undefined) return 1;
    if (firstPart === secondPart) continue;
    if (typeof firstPart === 'number' && typeof secondPart !== 'number') {
      return -1;
    }
    if (typeof firstPart !== 'number' && typeof secondPart === 'number') {
      return 1;
    }
    return firstPart > secondPart ? 1 : -1;
  }

  return 0;
}

export function isNewerRcRelease(
  latestVersion: string,
  current: VersionInfo,
): boolean {
  const legacyForkBuild =
    current.versionName === '1.2.20' && current.versionCode === 44;
  return (
    compareReleaseVersions(latestVersion, current.versionName) > 0 ||
    (legacyForkBuild && latestVersion !== current.versionName)
  );
}

/** Only official stable repository release assets may reach the public updater. */
export function isTrustedRcUpdateUrl(value: string): boolean {
  try {
    const normalizedUrl = new URL(value).href;
    return /^https:\/\/github\.com\/Belarrius1\/rc-freekiosk\/releases\/download\/[^/?#]+\/[^/?#]+\.apk(?:[?#].*)?$/i.test(
      normalizedUrl,
    );
  } catch {
    return false;
  }
}

export function isBatterySafeForPublicUpdate(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= MIN_PUBLIC_UPDATE_BATTERY_PERCENT &&
    value <= 100
  );
}

export default {
  /**
   * Get current app version (always available, even in Play Store builds)
   */
  getCurrentVersion(): Promise<VersionInfo> {
    return UpdateModule.getCurrentVersion();
  },

  /**
   * Check for available updates on GitHub (stable channel only)
   * No-op in Play Store builds.
   */
  checkForUpdates(): Promise<UpdateInfo> {
    if (!ENABLE_SELF_UPDATE) {
      return Promise.reject(
        new Error('Self-update disabled in Play Store builds'),
      );
    }
    return UpdateModule.checkForUpdates();
  },

  /**
   * Check for updates with optional beta/pre-release channel support.
   * No-op in Play Store builds.
   * @param includeBeta - If true, includes pre-release versions
   */
  checkForUpdatesWithChannel(includeBeta: boolean): Promise<UpdateInfo> {
    if (!ENABLE_SELF_UPDATE) {
      return Promise.reject(
        new Error('Self-update disabled in Play Store builds'),
      );
    }
    return UpdateModule.checkForUpdatesWithChannel(includeBeta);
  },

  /**
   * Check if the app has permission to install APKs from unknown sources.
   * No-op in Play Store builds.
   */
  checkInstallPermission(): Promise<boolean> {
    if (!ENABLE_SELF_UPDATE) {
      return Promise.resolve(false);
    }
    return UpdateModule.checkInstallPermission();
  },

  /**
   * Open the system settings page to allow installing from unknown sources.
   * No-op in Play Store builds.
   */
  openInstallPermissionSettings(): Promise<boolean> {
    if (!ENABLE_SELF_UPDATE) {
      return Promise.resolve(false);
    }
    return UpdateModule.openInstallPermissionSettings();
  },

  /**
   * Download and install an update.
   * No-op in Play Store builds.
   * @param downloadUrl - Direct download URL for the APK
   * @param version - Version string for display
   */
  downloadAndInstall(downloadUrl: string, version: string): Promise<boolean> {
    if (!ENABLE_SELF_UPDATE) {
      return Promise.reject(
        new Error('Self-update disabled in Play Store builds'),
      );
    }
    return UpdateModule.downloadAndInstall(downloadUrl, version);
  },

  /**
   * Public-kiosk update path. Never falls back to Android installation UI.
   */
  downloadAndInstallSilently(
    downloadUrl: string,
    version: string,
  ): Promise<boolean> {
    if (!ENABLE_SELF_UPDATE) {
      return Promise.reject(
        new Error('Self-update disabled in Play Store builds'),
      );
    }
    return UpdateModule.downloadAndInstallSilently(downloadUrl, version);
  },
};
