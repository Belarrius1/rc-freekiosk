import AsyncStorage from '@react-native-async-storage/async-storage';
import RcTerminalAuthModule, {
  RC_TERMINAL_APP_VERSION,
  RC_TERMINAL_KEY_ALIAS,
} from './RcTerminalAuthModule';
import { normalizeRcAppVersion, RC_TERMINAL_ORIGIN } from './rcTerminalBridge';

export const RC_TERMINAL_AUTH_PROTOCOL = 1 as const;
export const RC_TERMINAL_SESSION_URL = `${RC_TERMINAL_ORIGIN}/terminal/session`;

const ASSOCIATION_STORAGE_KEY = '@rc_terminal_association_v1';
const MAX_RESPONSE_LENGTH = 16 * 1024;
const REQUEST_TIMEOUT_MS = 15_000;
const ASSOCIATION_ID_PATTERN = /^[A-Fa-f0-9]{32}$/;
const TERMINAL_ID_PATTERN = /^RCT-[A-Z0-9]{4}-[A-Z0-9]{4}$/;
const OPAQUE_ID_PATTERN = /^[A-Fa-f0-9]{32}$/;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+={0,2}$/;
const BASE64URL_UNPADDED_PATTERN = /^[A-Za-z0-9_-]+$/;
const BASE64_SIGNATURE_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/;

export interface RcTerminalAssociation {
  protocol: 1;
  keyAlias: string;
  associationId: string;
  terminalId: string;
}

export interface RcTerminalPairing {
  pairingId: string;
  deviceSecret: string;
  userCode: string;
  verificationUri: string;
  verificationUriComplete: string;
  expiresAt: number;
  pollIntervalSeconds: number;
}

export type RcTerminalPairingStatus =
  | { status: 'pending'; pollIntervalSeconds: number }
  | { status: 'expired' | 'canceled' }
  | { status: 'approved'; association: RcTerminalAssociation };

export interface RcTerminalSession {
  ticket: string;
  expiresIn: number;
}

export class RcTerminalApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly retryAfter: number | null;
  readonly attemptsRemaining: number | null;

  constructor(
    code: string,
    status = 0,
    retryAfter: number | null = null,
    attemptsRemaining: number | null = null,
  ) {
    super(code);
    this.name = 'RcTerminalApiError';
    this.code = code;
    this.status = status;
    this.retryAfter = retryAfter;
    this.attemptsRemaining = attemptsRemaining;
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const asSafeInteger = (
  value: unknown,
  minimum: number,
  maximum: number,
): number | null =>
  typeof value === 'number' &&
  Number.isSafeInteger(value) &&
  value >= minimum &&
  value <= maximum
    ? value
    : null;

const isExactRcUrl = (value: unknown, path: string): value is string => {
  return value === `${RC_TERMINAL_ORIGIN}${path}`;
};

const parseJsonResponse = async (response: Response): Promise<unknown> => {
  const body = await response.text();
  if (body.length > MAX_RESPONSE_LENGTH) {
    throw new RcTerminalApiError('response_too_large', response.status);
  }
  try {
    return JSON.parse(body);
  } catch {
    throw new RcTerminalApiError('invalid_response', response.status);
  }
};

const postJson = async (
  path: string,
  payload: Record<string, unknown>,
  expectedStatus: number,
): Promise<Record<string, unknown>> => {
  const endpoint = `${RC_TERMINAL_ORIGIN}${path}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
      credentials: 'omit',
    });
  } catch {
    throw new RcTerminalApiError('network_error');
  } finally {
    clearTimeout(timeout);
  }

  if (response.url && response.url !== endpoint) {
    throw new RcTerminalApiError('invalid_response', response.status);
  }

  const parsed = await parseJsonResponse(response);
  if (!isRecord(parsed)) {
    throw new RcTerminalApiError('invalid_response', response.status);
  }
  if (!response.ok || parsed.success !== true) {
    const code =
      typeof parsed.error === 'string' ? parsed.error : 'request_failed';
    throw new RcTerminalApiError(
      code,
      response.status,
      asSafeInteger(parsed.retryAfter, 0, 86_400),
      asSafeInteger(parsed.attemptsRemaining, 0, 10),
    );
  }
  if (response.status !== expectedStatus) {
    throw new RcTerminalApiError('invalid_response', response.status);
  }
  return parsed;
};

const isAssociation = (value: unknown): value is RcTerminalAssociation =>
  isRecord(value) &&
  value.protocol === RC_TERMINAL_AUTH_PROTOCOL &&
  value.keyAlias === RC_TERMINAL_KEY_ALIAS &&
  typeof value.associationId === 'string' &&
  ASSOCIATION_ID_PATTERN.test(value.associationId) &&
  typeof value.terminalId === 'string' &&
  TERMINAL_ID_PATTERN.test(value.terminalId);

export const getRcTerminalAppVersion = (): string =>
  normalizeRcAppVersion(RC_TERMINAL_APP_VERSION);

export const loadRcTerminalAssociation =
  async (): Promise<RcTerminalAssociation | null> => {
    try {
      const raw = await AsyncStorage.getItem(ASSOCIATION_STORAGE_KEY);
      if (!raw) return null;
      const parsed: unknown = JSON.parse(raw);
      if (!isAssociation(parsed) || !(await RcTerminalAuthModule.hasKey())) {
        await AsyncStorage.removeItem(ASSOCIATION_STORAGE_KEY);
        return null;
      }
      return parsed;
    } catch {
      await AsyncStorage.removeItem(ASSOCIATION_STORAGE_KEY);
      return null;
    }
  };

const saveRcTerminalAssociation = async (
  association: RcTerminalAssociation,
): Promise<void> => {
  await AsyncStorage.setItem(
    ASSOCIATION_STORAGE_KEY,
    JSON.stringify(association),
  );
};

export const resetRcTerminalAssociation = async (): Promise<void> => {
  await AsyncStorage.removeItem(ASSOCIATION_STORAGE_KEY);
  await RcTerminalAuthModule.deleteKey();
};

export const startRcTerminalPairing = async (): Promise<RcTerminalPairing> => {
  const publicKey = await RcTerminalAuthModule.ensureKey();
  const response = await postJson(
    '/terminal/pairing/start',
    {
      protocol: RC_TERMINAL_AUTH_PROTOCOL,
      appVersion: getRcTerminalAppVersion(),
      publicKey,
    },
    201,
  );

  const expiresIn = asSafeInteger(response.expiresIn, 1, 3600);
  const pollInterval = asSafeInteger(response.pollInterval, 1, 300);
  if (
    response.protocol !== RC_TERMINAL_AUTH_PROTOCOL ||
    typeof response.pairingId !== 'string' ||
    !OPAQUE_ID_PATTERN.test(response.pairingId) ||
    typeof response.deviceSecret !== 'string' ||
    !BASE64URL_PATTERN.test(response.deviceSecret) ||
    response.deviceSecret.length < 16 ||
    response.deviceSecret.length > 2048 ||
    typeof response.userCode !== 'string' ||
    !/^[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(response.userCode) ||
    !isExactRcUrl(response.verificationUri, '/terminal/pairing/approve') ||
    response.verificationUriComplete !==
      `${response.verificationUri}?code=${response.userCode}` ||
    expiresIn === null ||
    pollInterval === null
  ) {
    throw new RcTerminalApiError('invalid_response', 201);
  }

  return {
    pairingId: response.pairingId,
    deviceSecret: response.deviceSecret,
    userCode: response.userCode,
    verificationUri: response.verificationUri,
    verificationUriComplete: response.verificationUriComplete,
    expiresAt: Date.now() + expiresIn * 1000,
    pollIntervalSeconds: pollInterval,
  };
};

export const pollRcTerminalPairing = async (
  pairing: RcTerminalPairing,
): Promise<RcTerminalPairingStatus> => {
  const response = await postJson(
    '/terminal/pairing/status',
    {
      pairingId: pairing.pairingId,
      deviceSecret: pairing.deviceSecret,
    },
    200,
  );

  if (response.status === 'pending') {
    const pollInterval = asSafeInteger(response.pollInterval, 1, 300);
    if (pollInterval === null) {
      throw new RcTerminalApiError('invalid_response');
    }
    return { status: 'pending', pollIntervalSeconds: pollInterval };
  }
  if (response.status === 'expired' || response.status === 'canceled') {
    return { status: response.status };
  }
  if (
    response.status === 'approved' &&
    typeof response.associationId === 'string' &&
    ASSOCIATION_ID_PATTERN.test(response.associationId) &&
    typeof response.terminalId === 'string' &&
    TERMINAL_ID_PATTERN.test(response.terminalId)
  ) {
    const association: RcTerminalAssociation = {
      protocol: RC_TERMINAL_AUTH_PROTOCOL,
      keyAlias: RC_TERMINAL_KEY_ALIAS,
      associationId: response.associationId,
      terminalId: response.terminalId,
    };
    await saveRcTerminalAssociation(association);
    return { status: 'approved', association };
  }
  throw new RcTerminalApiError('invalid_response');
};

/* Base64 decoding is intentionally implemented without browser globals. */
/* eslint-disable no-bitwise */
export const decodeRcBase64Url = (value: string): Uint8Array => {
  if (!BASE64URL_UNPADDED_PATTERN.test(value) || value.length % 4 === 1) {
    throw new RcTerminalApiError('invalid_nonce');
  }
  const alphabet =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  const output: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (const character of value) {
    const index = alphabet.indexOf(character);
    if (index < 0) throw new RcTerminalApiError('invalid_nonce');
    buffer = (buffer << 6) | index;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      output.push((buffer >> bits) & 0xff);
    }
  }
  if (bits > 0 && (buffer & ((1 << bits) - 1)) !== 0) {
    throw new RcTerminalApiError('invalid_nonce');
  }
  return Uint8Array.from(output);
};
/* eslint-enable no-bitwise */

export const buildRcTerminalLoginMessage = (
  associationId: string,
  challengeId: string,
  nonce: string,
  appVersion: string,
): string =>
  [
    'RC_TERMINAL_LOGIN_V1',
    RC_TERMINAL_ORIGIN,
    associationId,
    challengeId,
    nonce,
    'terminal_quick_login',
    appVersion,
    '',
  ].join('\n');

export const authenticateRcTerminal = async (
  association: RcTerminalAssociation,
  pin: string,
): Promise<RcTerminalSession> => {
  if (!isAssociation(association) || !/^\d{6,10}$/.test(pin)) {
    throw new RcTerminalApiError('invalid_request');
  }
  const challenge = await postJson(
    '/terminal/auth/challenge',
    {
      protocol: RC_TERMINAL_AUTH_PROTOCOL,
      associationId: association.associationId,
    },
    201,
  );
  const expiresIn = asSafeInteger(challenge.expiresIn, 1, 300);
  if (
    challenge.protocol !== RC_TERMINAL_AUTH_PROTOCOL ||
    typeof challenge.challengeId !== 'string' ||
    !OPAQUE_ID_PATTERN.test(challenge.challengeId) ||
    typeof challenge.nonce !== 'string' ||
    challenge.signatureAlgorithm !== 'ECDSA_P256_SHA256_DER' ||
    expiresIn === null ||
    decodeRcBase64Url(challenge.nonce).length !== 32
  ) {
    throw new RcTerminalApiError('invalid_response', 201);
  }

  const appVersion = getRcTerminalAppVersion();
  const message = buildRcTerminalLoginMessage(
    association.associationId,
    challenge.challengeId,
    challenge.nonce,
    appVersion,
  );
  const signature = await RcTerminalAuthModule.sign(message);
  if (!BASE64_SIGNATURE_PATTERN.test(signature)) {
    throw new RcTerminalApiError('verification_failed');
  }

  const verified = await postJson(
    '/terminal/auth/verify',
    {
      protocol: RC_TERMINAL_AUTH_PROTOCOL,
      associationId: association.associationId,
      challengeId: challenge.challengeId,
      nonce: challenge.nonce,
      signature,
      pin,
      appVersion,
    },
    200,
  );
  const ticketExpiresIn = asSafeInteger(verified.expiresIn, 1, 30);
  if (
    typeof verified.ticket !== 'string' ||
    !BASE64URL_PATTERN.test(verified.ticket) ||
    verified.ticket.length < 16 ||
    verified.ticket.length > 2048 ||
    ticketExpiresIn === null ||
    !isExactRcUrl(verified.sessionUrl, '/terminal/session') ||
    verified.sessionMethod !== 'POST' ||
    verified.sessionField !== 'ticket'
  ) {
    throw new RcTerminalApiError('invalid_response', 200);
  }

  return { ticket: verified.ticket, expiresIn: ticketExpiresIn };
};
