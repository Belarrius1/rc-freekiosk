export const RC_TERMINAL_ORIGIN = 'https://reliccommander.com';

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
