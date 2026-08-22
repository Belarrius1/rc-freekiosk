/**
 * Privacy-sensitive capabilities intentionally disabled in RC-FreeKiosk.
 *
 * Keep these gates separate from user preferences: an old saved setting or a
 * remote command must not be able to re-enable hardware capture accidentally.
 * Wi-Fi, Bluetooth and audio output are not affected by these restrictions.
 */
export const FORK_CAPABILITIES = {
  cameraCapture: false,
  microphoneCapture: false,
  locationTelemetry: false,
} as const;
