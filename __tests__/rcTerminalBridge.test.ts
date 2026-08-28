import {
  buildRcTerminalCapabilities,
  buildRcTerminalCapabilitiesResponseScript,
  getRcTerminalSessionStateFromUrl,
  isRcTerminalCapabilitiesRequest,
  isRcMusicPlayerNavigationAllowed,
  isRelicCommanderMusicPlayerUrl,
  isRelicCommanderUrl,
  normalizeRcAppVersion,
  isSoundCloudPlayerWidgetUrl,
  shouldReturnToRcHome,
} from '../src/utils/rcTerminalBridge';

describe('Relic Commander terminal capabilities bridge', () => {
  it('publishes the low-performance terminal profile defined by protocol 1', () => {
    expect(buildRcTerminalCapabilities('1.2.20')).toEqual({
      protocol: 1,
      terminal: true,
      appVersion: '1.2.20',
      performanceProfile: 'low',
      capabilities: {
        animations: false,
        modalAnimations: false,
        video: true,
        webgl: false,
        threeD: false,
      },
    });
  });

  it('accepts only the exact Relic Commander HTTPS origin', () => {
    expect(isRelicCommanderUrl('https://reliccommander.com/game?id=1')).toBe(
      true,
    );
    expect(isRelicCommanderUrl('https://reliccommander.com.evil.test')).toBe(
      false,
    );
    expect(isRelicCommanderUrl('https://www.reliccommander.com')).toBe(false);
    expect(isRelicCommanderUrl('http://reliccommander.com')).toBe(false);
    expect(isRelicCommanderUrl('https://reliccommander.com:444/game')).toBe(
      false,
    );
    expect(isRelicCommanderUrl('https://user@reliccommander.com/game')).toBe(
      false,
    );
    expect(isRelicCommanderUrl('not a url')).toBe(false);
  });

  it('derives the known Terminal session state from main RC routes only', () => {
    expect(
      getRcTerminalSessionStateFromUrl('https://reliccommander.com/game?id=1'),
    ).toBe(true);
    expect(
      getRcTerminalSessionStateFromUrl('https://reliccommander.com/game/map'),
    ).toBe(true);
    expect(
      getRcTerminalSessionStateFromUrl('https://reliccommander.com/login'),
    ).toBe(false);
    expect(
      getRcTerminalSessionStateFromUrl('https://reliccommander.com/'),
    ).toBe(false);
    expect(
      getRcTerminalSessionStateFromUrl('https://reliccommander.com/news'),
    ).toBeNull();
    expect(
      getRcTerminalSessionStateFromUrl('https://example.com/game'),
    ).toBeNull();
  });

  it('accepts only the protocol 1 capabilities request', () => {
    expect(
      isRcTerminalCapabilitiesRequest(
        JSON.stringify({
          type: 'RC_TERMINAL_CAPABILITIES_REQUEST',
          protocol: 1,
        }),
      ),
    ).toBe(true);
    expect(
      isRcTerminalCapabilitiesRequest(
        JSON.stringify({
          type: 'RC_TERMINAL_CAPABILITIES_REQUEST',
          protocol: 2,
        }),
      ),
    ).toBe(false);
    expect(isRcTerminalCapabilitiesRequest('{invalid')).toBe(false);
  });

  it('confines only the main Relic Commander document to its origin', () => {
    expect(
      shouldReturnToRcHome(
        'https://reliccommander.com/game',
        'https://studio.example.com',
        true,
      ),
    ).toBe(true);
    expect(
      shouldReturnToRcHome(
        'https://reliccommander.com/game',
        'https://studio.example.com',
        undefined,
      ),
    ).toBe(true);
    expect(
      shouldReturnToRcHome(
        'https://reliccommander.com/game',
        'https://reliccommander.com/profile',
        true,
      ),
    ).toBe(false);
    expect(
      shouldReturnToRcHome(
        'https://reliccommander.com/game',
        'https://challenges.cloudflare.com/turnstile/v0/',
        false,
      ),
    ).toBe(false);
    expect(
      shouldReturnToRcHome(
        'https://reliccommander.com/game',
        'about:blank',
        true,
      ),
    ).toBe(false);
    expect(
      shouldReturnToRcHome(
        'https://another-kiosk.example.com',
        'https://studio.example.com',
        true,
      ),
    ).toBe(false);
  });

  it('locks the persistent music WebView to the documented player modes', () => {
    expect(
      isRelicCommanderMusicPlayerUrl(
        'https://reliccommander.com/music_player?direct=1',
      ),
    ).toBe(true);
    expect(
      isRelicCommanderMusicPlayerUrl(
        'https://reliccommander.com/music_player?direct',
      ),
    ).toBe(true);
    expect(
      isRelicCommanderMusicPlayerUrl('https://reliccommander.com/music_player'),
    ).toBe(true);
    expect(
      isRelicCommanderMusicPlayerUrl(
        'https://reliccommander.com/music_player?direct=2',
      ),
    ).toBe(false);
    expect(
      isRcMusicPlayerNavigationAllowed(
        'https://w.soundcloud.com/player/',
        false,
      ),
    ).toBe(true);
    expect(
      isSoundCloudPlayerWidgetUrl(
        'https://w.soundcloud.com/player/?url=https%3A%2F%2Fapi.soundcloud.com',
      ),
    ).toBe(true);
    expect(
      isRcMusicPlayerNavigationAllowed(
        'https://soundcloud.com/artist/track',
        false,
      ),
    ).toBe(false);
    expect(
      isRcMusicPlayerNavigationAllowed(
        'https://w.soundcloud.com/player.evil/path',
        false,
      ),
    ).toBe(false);
    expect(
      isRcMusicPlayerNavigationAllowed(
        'https://w.soundcloud.com/player/',
        true,
      ),
    ).toBe(false);
    expect(
      isRcMusicPlayerNavigationAllowed(
        'http://w.soundcloud.com/player/',
        false,
      ),
    ).toBe(false);
    expect(
      isRcMusicPlayerNavigationAllowed('intent://external-app', true),
    ).toBe(false);
  });

  it('guarantees a contract-safe application version', () => {
    expect(normalizeRcAppVersion('v1.0.0-beta+3')).toBe('v1.0.0-beta+3');
    expect(normalizeRcAppVersion(' invalid version ')).toBe('unknown');
    expect(normalizeRcAppVersion(`v${'1'.repeat(40)}`)).toBe('unknown');
  });

  it('builds a main-document CustomEvent response script', () => {
    const script = buildRcTerminalCapabilitiesResponseScript('1.2.20');

    expect(script).toContain('new CustomEvent("rc-terminal-capabilities"');
    expect(script).toContain('"appVersion":"1.2.20"');
    expect(script).toContain('"performanceProfile":"low"');
    expect(script.trim().endsWith('true;')).toBe(true);
  });
});
