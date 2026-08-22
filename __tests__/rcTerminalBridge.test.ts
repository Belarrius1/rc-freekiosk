import {
  buildRcTerminalCapabilities,
  buildRcTerminalCapabilitiesResponseScript,
  isRcTerminalCapabilitiesRequest,
  isRelicCommanderUrl,
  normalizeRcAppVersion,
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
