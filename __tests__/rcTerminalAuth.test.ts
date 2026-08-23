jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

import {
  buildRcTerminalLoginMessage,
  decodeRcBase64Url,
  RC_TERMINAL_SESSION_URL,
} from '../src/utils/rcTerminalAuth';

describe('Relic Commander Terminal authentication contract', () => {
  it('serializes the signed message with exact LF separators and a terminal LF', () => {
    const message = buildRcTerminalLoginMessage(
      'fedcba9876543210fedcba9876543210',
      '00112233445566778899aabbccddeeff',
      'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      '1.2.20',
    );

    expect(message).toBe(
      'RC_TERMINAL_LOGIN_V1\n' +
        'https://reliccommander.com\n' +
        'fedcba9876543210fedcba9876543210\n' +
        '00112233445566778899aabbccddeeff\n' +
        'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA\n' +
        'terminal_quick_login\n' +
        '1.2.20\n',
    );
    expect(message).not.toContain('\r');
  });

  it('decodes an unpadded canonical Base64URL nonce to exactly 32 bytes', () => {
    const decoded = decodeRcBase64Url(
      'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    );

    expect(decoded).toHaveLength(32);
    expect(Array.from(decoded)).toEqual(new Array(32).fill(0));
  });

  it('rejects padding, invalid characters and non-canonical trailing bits', () => {
    expect(() => decodeRcBase64Url('AAAA=')).toThrow('invalid_nonce');
    expect(() => decodeRcBase64Url('AAAA+')).toThrow('invalid_nonce');
    expect(() => decodeRcBase64Url('AB')).toThrow('invalid_nonce');
  });

  it('pins the session handoff to the sole documented endpoint', () => {
    expect(RC_TERMINAL_SESSION_URL).toBe(
      'https://reliccommander.com/terminal/session',
    );
  });
});
