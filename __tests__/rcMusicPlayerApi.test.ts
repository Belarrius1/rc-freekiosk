import {
  parseRcMusicPlayerStateMessage,
  RC_MUSIC_TEXT_LIMIT,
} from '../src/utils/rcMusicPlayerApi';

describe('Relic Commander music player API', () => {
  it('validates and normalizes a protocol-1 state snapshot', () => {
    expect(
      parseRcMusicPlayerStateMessage(
        JSON.stringify({
          type: 'RC_MUSIC_PLAYER_STATE',
          protocol: 1,
          reason: 'play',
          state: {
            available: true,
            ready: true,
            playing: true,
            status: 'playing',
            direct: true,
            trackIndex: 3,
            trackCount: 12,
            title: 'Terminal Horizon',
            artist: 'Belarrius',
            positionMs: 12345.4,
            durationMs: 240000,
          },
        }),
      ),
    ).toEqual({
      available: true,
      ready: true,
      playing: true,
      status: 'playing',
      direct: true,
      trackIndex: 3,
      trackCount: 12,
      title: 'Terminal Horizon',
      artist: 'Belarrius',
      positionMs: 12345,
      durationMs: 240000,
    });
  });

  it('accepts future statuses while relying on the documented booleans', () => {
    const state = parseRcMusicPlayerStateMessage(
      JSON.stringify({
        type: 'RC_MUSIC_PLAYER_STATE',
        protocol: 1,
        state: {
          available: true,
          ready: false,
          playing: false,
          status: 'future_buffering_mode',
        },
      }),
    );

    expect(state?.status).toBe('future_buffering_mode');
    expect(state?.ready).toBe(false);
  });

  it('rejects invalid envelopes and required fields', () => {
    expect(parseRcMusicPlayerStateMessage('{invalid')).toBeNull();
    expect(
      parseRcMusicPlayerStateMessage(
        JSON.stringify({
          type: 'RC_MUSIC_PLAYER_STATE',
          protocol: 2,
          state: { available: true, ready: true, playing: true },
        }),
      ),
    ).toBeNull();
    expect(
      parseRcMusicPlayerStateMessage(
        JSON.stringify({
          type: 'RC_MUSIC_PLAYER_STATE',
          protocol: 1,
          state: { available: 'yes', ready: true, playing: true },
        }),
      ),
    ).toBeNull();
  });

  it('bounds untrusted metadata and discards malformed optional values', () => {
    const state = parseRcMusicPlayerStateMessage(
      JSON.stringify({
        type: 'RC_MUSIC_PLAYER_STATE',
        protocol: 1,
        state: {
          available: true,
          ready: true,
          playing: false,
          status: 42,
          title: '<b>' + 'a'.repeat(RC_MUSIC_TEXT_LIMIT * 2) + '</b>',
          artist: { html: 'unsafe' },
          trackIndex: -1,
          trackCount: 4.2,
          positionMs: 999,
          durationMs: 100,
        },
      }),
    );

    expect(state?.status).toBe('unknown');
    expect(state?.title).toHaveLength(RC_MUSIC_TEXT_LIMIT);
    expect(state?.title.startsWith('<b>')).toBe(true);
    expect(state?.artist).toBe('');
    expect(state?.trackIndex).toBeNull();
    expect(state?.trackCount).toBeNull();
    expect(state?.positionMs).toBe(100);
  });
});
