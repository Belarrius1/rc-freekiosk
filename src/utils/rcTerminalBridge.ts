export const RC_TERMINAL_ORIGIN = 'https://reliccommander.com';
export const RC_TERMINAL_HOME = `${RC_TERMINAL_ORIGIN}/`;
export const RC_TERMINAL_MUSIC_PLAYER = `${RC_TERMINAL_ORIGIN}/music_player?direct=1`;

export const RC_TERMINAL_CAPABILITIES_REQUEST =
  'RC_TERMINAL_CAPABILITIES_REQUEST';

export const RC_TERMINAL_CAPABILITIES_EVENT = 'rc-terminal-capabilities';

const APP_VERSION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,39}$/;
const UNKNOWN_APP_VERSION = 'unknown';

export interface RcTerminalCapabilities {
  protocol: 1;
  terminal: true;
  appVersion: string;
  performanceProfile: 'low';
  capabilities: {
    animations: false;
    modalAnimations: false;
    video: true;
    webgl: false;
    threeD: false;
  };
}

export const normalizeRcAppVersion = (value: unknown): string => {
  if (typeof value !== 'string') {
    return UNKNOWN_APP_VERSION;
  }

  const version = value.trim();
  return APP_VERSION_PATTERN.test(version) ? version : UNKNOWN_APP_VERSION;
};

export const buildRcTerminalCapabilities = (
  appVersion: unknown,
): RcTerminalCapabilities => ({
  protocol: 1,
  terminal: true,
  appVersion: normalizeRcAppVersion(appVersion),
  performanceProfile: 'low',
  capabilities: {
    animations: false,
    modalAnimations: false,
    video: true,
    webgl: false,
    threeD: false,
  },
});

export const isRelicCommanderUrl = (value: unknown): boolean => {
  if (typeof value !== 'string') {
    return false;
  }

  try {
    const normalizedUrl = new URL(value).href;
    return normalizedUrl.startsWith(`${RC_TERMINAL_ORIGIN}/`);
  } catch {
    return false;
  }
};

export const getRcTerminalSessionStateFromUrl = (
  value: unknown,
): boolean | null => {
  if (!isRelicCommanderUrl(value) || typeof value !== 'string') {
    return null;
  }

  try {
    const normalizedUrl = new URL(value).href;
    const pathWithQuery = normalizedUrl.slice(RC_TERMINAL_ORIGIN.length);
    const pathname =
      pathWithQuery.split(/[?#]/, 1)[0].replace(/\/+$/, '') || '/';
    if (pathname === '/game' || pathname.startsWith('/game/')) {
      return true;
    }
    if (
      pathname === '/' ||
      pathname === '/index' ||
      pathname === '/login' ||
      pathname === '/logout'
    ) {
      return false;
    }
    return null;
  } catch {
    return null;
  }
};

const isInternalWebViewDocument = (value: unknown): boolean =>
  typeof value === 'string' &&
  /^(?:about:blank|about:srcdoc)(?:[?#]|$)/i.test(value);

export const isRelicCommanderMusicPlayerUrl = (value: unknown): boolean => {
  if (typeof value !== 'string') {
    return false;
  }

  try {
    const normalizedUrl = new URL(value).href;
    const playerUrl = `${RC_TERMINAL_ORIGIN}/music_player`;
    return (
      normalizedUrl === playerUrl ||
      normalizedUrl.startsWith(`${playerUrl}#`) ||
      normalizedUrl === `${playerUrl}?direct` ||
      normalizedUrl.startsWith(`${playerUrl}?direct#`) ||
      normalizedUrl === `${playerUrl}?direct=1` ||
      normalizedUrl.startsWith(`${playerUrl}?direct=1#`)
    );
  } catch {
    return false;
  }
};

export const isSoundCloudPlayerWidgetUrl = (value: unknown): boolean => {
  if (typeof value !== 'string') {
    return false;
  }

  try {
    const normalizedUrl = new URL(value).href;
    const widgetUrl = 'https://w.soundcloud.com/player';
    return (
      normalizedUrl === widgetUrl ||
      normalizedUrl.startsWith(`${widgetUrl}/`) ||
      normalizedUrl.startsWith(`${widgetUrl}?`)
    );
  } catch {
    return false;
  }
};

export const isRcMusicPlayerNavigationAllowed = (
  targetUrl: unknown,
  isTopFrame: boolean | undefined,
): boolean =>
  isInternalWebViewDocument(targetUrl) ||
  (isTopFrame === false &&
    (isSoundCloudPlayerWidgetUrl(targetUrl) ||
      (typeof targetUrl === 'string' &&
        /^https:\/\/challenges\.cloudflare\.com(?:[/:?#]|$)/i.test(
          targetUrl,
        )))) ||
  isRelicCommanderMusicPlayerUrl(targetUrl);

export const shouldReturnToRcHome = (
  kioskUrl: unknown,
  targetUrl: unknown,
  isTopFrame: boolean | undefined,
): boolean =>
  isTopFrame !== false &&
  isRelicCommanderUrl(kioskUrl) &&
  !isRelicCommanderUrl(targetUrl) &&
  !isInternalWebViewDocument(targetUrl);

export const isRcTerminalCapabilitiesRequest = (value: unknown): boolean => {
  if (typeof value !== 'string') {
    return false;
  }

  try {
    const message = JSON.parse(value);
    return (
      typeof message === 'object' &&
      message !== null &&
      !Array.isArray(message) &&
      message.type === RC_TERMINAL_CAPABILITIES_REQUEST &&
      message.protocol === 1
    );
  } catch {
    return false;
  }
};

export const buildRcTerminalCapabilitiesResponseScript = (
  appVersion: unknown,
): string => {
  const detail = JSON.stringify(buildRcTerminalCapabilities(appVersion));
  const eventName = JSON.stringify(RC_TERMINAL_CAPABILITIES_EVENT);

  return `
    (function() {
      window.dispatchEvent(new CustomEvent(${eventName}, {
        detail: ${detail}
      }));
    }());
    true;
  `;
};
