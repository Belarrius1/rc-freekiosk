export const RC_MUSIC_PLAYER_PROTOCOL = 1;
export const RC_MUSIC_TEXT_LIMIT = 160;

export interface RcMusicPlayerState {
  available: boolean;
  ready: boolean;
  playing: boolean;
  status: string;
  direct: boolean;
  trackIndex: number | null;
  trackCount: number | null;
  title: string;
  artist: string;
  positionMs: number;
  durationMs: number;
}

export const EMPTY_RC_MUSIC_PLAYER_STATE: RcMusicPlayerState = {
  available: false,
  ready: false,
  playing: false,
  status: 'connecting',
  direct: true,
  trackIndex: null,
  trackCount: null,
  title: '',
  artist: '',
  positionMs: 0,
  durationMs: 0,
};

function safeText(value: unknown, maxLength = RC_MUSIC_TEXT_LIMIT): string {
  return typeof value === 'string' ? value.slice(0, maxLength) : '';
}

function safeNonNegativeInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
    ? value
    : null;
}

function safeMilliseconds(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.round(value)
    : 0;
}

/** Validate and normalize the public protocol-1 state message from RC. */
export function parseRcMusicPlayerStateMessage(
  rawMessage: string,
): RcMusicPlayerState | null {
  let message: unknown;

  try {
    message = JSON.parse(rawMessage);
  } catch {
    return null;
  }

  if (!message || typeof message !== 'object') return null;
  const payload = message as Record<string, unknown>;
  if (
    payload.type !== 'RC_MUSIC_PLAYER_STATE' ||
    payload.protocol !== RC_MUSIC_PLAYER_PROTOCOL ||
    !payload.state ||
    typeof payload.state !== 'object'
  ) {
    return null;
  }

  const state = payload.state as Record<string, unknown>;
  if (
    typeof state.available !== 'boolean' ||
    typeof state.ready !== 'boolean' ||
    typeof state.playing !== 'boolean'
  ) {
    return null;
  }

  const durationMs = safeMilliseconds(state.durationMs);
  const positionMs = Math.min(safeMilliseconds(state.positionMs), durationMs);

  return {
    available: state.available,
    ready: state.ready,
    playing: state.playing,
    // Unknown future statuses remain usable; UI logic relies on the booleans.
    status: safeText(state.status, 40) || 'unknown',
    direct: typeof state.direct === 'boolean' ? state.direct : false,
    trackIndex: safeNonNegativeInteger(state.trackIndex),
    trackCount: safeNonNegativeInteger(state.trackCount),
    title: safeText(state.title),
    artist: safeText(state.artist),
    positionMs,
    durationMs,
  };
}
