import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import type { GestureResponderEvent, LayoutChangeEvent } from 'react-native';
import { NativeModules } from 'react-native';
import { WebView } from 'react-native-webview';
import type {
  ShouldStartLoadRequest,
  WebViewErrorEvent,
} from 'react-native-webview/lib/WebViewTypes';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import { RC_THEME } from '../theme/relicCommanderTheme';
import {
  EMPTY_RC_MUSIC_PLAYER_STATE,
  parseRcMusicPlayerStateMessage,
} from '../utils/rcMusicPlayerApi';
import type { RcMusicPlayerState } from '../utils/rcMusicPlayerApi';
import {
  buildRcTerminalCapabilitiesResponseScript,
  isRcMusicPlayerNavigationAllowed,
  isRcTerminalCapabilitiesRequest,
  isRelicCommanderUrl,
  RC_TERMINAL_MUSIC_PLAYER,
} from '../utils/rcTerminalBridge';

interface Props {
  visible: boolean;
  hideMusicIcon: boolean;
  onClose: () => void;
  onHideMusicIconChange: (hidden: boolean) => void;
  onPlaybackStateChange: (state: MusicPlaybackState) => void;
}

export interface MusicPlaybackState {
  available: boolean;
  ready: boolean;
  playing: boolean;
}

export interface RelicCommanderMusicPlayerRef {
  play: () => void;
  pause: () => void;
  toggle: () => void;
  next: () => void;
  previous: () => void;
  seekTo: (positionMs: number) => void;
  requestState: () => void;
  toggleMuted: () => void;
}

type PlayerCommand = 'play' | 'pause' | 'toggle' | 'next' | 'previous';

const { UpdateModule } = NativeModules;

const CAPABILITIES_RESPONSE_SCRIPT = buildRcTerminalCapabilitiesResponseScript(
  UpdateModule?.VERSION_NAME,
);

// RCMusicPlayer is the authoritative transport/state bridge. SoundCloud is
// touched here only to preserve the previously requested volume mute control,
// which protocol 1 does not expose yet.
const MUSIC_API_BOOTSTRAP_SCRIPT = `
  (function() {
    function requestState() {
      if (window.RCMusicPlayer && typeof window.RCMusicPlayer.requestState === 'function') {
        window.RCMusicPlayer.requestState();
      }
    }

    window.addEventListener('rc-music-player-api-ready', requestState);
    requestState();

    if (window.__RC_KIOSK_MUTE_BRIDGE__) return;
    window.__RC_KIOSK_MUTE_BRIDGE__ = true;

    var widget = null;
    var muted = false;
    var previousVolume = 100;
    var lastMuted = null;

    function publishMuted() {
      if (lastMuted === muted) return;
      lastMuted = muted;
      window.ReactNativeWebView.postMessage(JSON.stringify({
        type: 'RC_MUSIC_PLAYER_MUTE_STATE',
        protocol: 1,
        muted: muted
      }));
    }

    function syncVolume() {
      if (!widget) return;
      widget.getVolume(function(value) {
        var volume = Number(value);
        if (!Number.isFinite(volume)) return;
        if (volume > 0) previousVolume = volume;
        muted = volume <= 0;
        publishMuted();
      });
    }

    window.__rcKioskToggleMusicMuted = function() {
      if (!widget) return;
      widget.getVolume(function(value) {
        var volume = Number(value);
        if (!Number.isFinite(volume)) volume = muted ? 0 : previousVolume;
        if (volume > 0) previousVolume = volume;
        var nextVolume = volume > 0 ? 0 : Math.max(1, previousVolume || 100);
        widget.setVolume(nextVolume);
        muted = nextVolume === 0;
        publishMuted();
      });
    };

    function bindWidget() {
      var frame = document.getElementById('sc-widget') ||
        document.querySelector('iframe[src*="w.soundcloud.com/player"]');
      if (!frame || !window.SC || !window.SC.Widget) {
        window.setTimeout(bindWidget, 250);
        return;
      }

      widget = window.SC.Widget(frame);
      syncVolume();
      window.setInterval(syncVolume, 2000);
    }

    bindWidget();
  }());
  true;
`;

function formatTime(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = String(totalSeconds % 60).padStart(2, '0');
  return `${minutes}:${seconds}`;
}

function statusLabel(state: RcMusicPlayerState, error: boolean): string {
  if (error) return 'UNAVAILABLE';
  if (!state.available) return 'CONNECTING';
  return state.status.replace(/_/g, ' ').toUpperCase();
}

/** Persistent hidden RC audio engine with a native, kiosk-safe controller. */
const RelicCommanderMusicPlayer = forwardRef<
  RelicCommanderMusicPlayerRef,
  Props
>(
  (
    {
      visible,
      hideMusicIcon,
      onClose,
      onHideMusicIconChange,
      onPlaybackStateChange,
    },
    ref,
  ) => {
    const webViewRef = useRef<WebView>(null);
    const [webViewGeneration, setWebViewGeneration] = useState(0);
    const [playerState, setPlayerState] = useState<RcMusicPlayerState>(
      EMPTY_RC_MUSIC_PLAYER_STATE,
    );
    const [muted, setMuted] = useState(false);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(false);
    const [progressWidth, setProgressWidth] = useState(0);
    const { width, height } = useWindowDimensions();
    const isLandscape = width > height;

    const publishPlaybackSummary = useCallback(
      (state: RcMusicPlayerState): void => {
        onPlaybackStateChange({
          available: state.available,
          ready: state.ready,
          playing: state.playing,
        });
      },
      [onPlaybackStateChange],
    );

    const injectScript = useCallback((script: string): void => {
      webViewRef.current?.injectJavaScript(`${script}\ntrue;`);
    }, []);

    const runPlayerCommand = useCallback(
      (command: PlayerCommand): void => {
        injectScript(
          `(function(){var player=window.RCMusicPlayer;if(player&&typeof player.${command}==='function'){player.${command}();}}());`,
        );
      },
      [injectScript],
    );

    const requestState = useCallback((): void => {
      injectScript(
        `(function(){var player=window.RCMusicPlayer;if(player&&typeof player.requestState==='function'){player.requestState();}}());`,
      );
    }, [injectScript]);

    const seekTo = useCallback(
      (positionMs: number): void => {
        if (!Number.isFinite(positionMs) || positionMs < 0) return;
        const safePosition = Math.round(positionMs);
        injectScript(
          `(function(){var player=window.RCMusicPlayer;if(player&&typeof player.seekTo==='function'){player.seekTo(${safePosition});}}());`,
        );
      },
      [injectScript],
    );

    const toggleMuted = useCallback((): void => {
      injectScript(
        'window.__rcKioskToggleMusicMuted && window.__rcKioskToggleMusicMuted();',
      );
    }, [injectScript]);

    useImperativeHandle(
      ref,
      () => ({
        play: () => runPlayerCommand('play'),
        pause: () => runPlayerCommand('pause'),
        toggle: () => runPlayerCommand('toggle'),
        next: () => runPlayerCommand('next'),
        previous: () => runPlayerCommand('previous'),
        seekTo,
        requestState,
        toggleMuted,
      }),
      [requestState, runPlayerCommand, seekTo, toggleMuted],
    );

    useEffect(() => {
      if (visible) requestState();
    }, [requestState, visible]);

    const resetPlayer = useCallback((): void => {
      setPlayerState(EMPTY_RC_MUSIC_PLAYER_STATE);
      setMuted(false);
      publishPlaybackSummary(EMPTY_RC_MUSIC_PLAYER_STATE);
      setError(false);
      setLoading(true);
      setWebViewGeneration(current => current + 1);
    }, [publishPlaybackSummary]);

    const handleMessage = useCallback(
      (event: any): void => {
        if (!isRelicCommanderUrl(event.nativeEvent.url)) return;

        if (isRcTerminalCapabilitiesRequest(event.nativeEvent.data)) {
          webViewRef.current?.injectJavaScript(CAPABILITIES_RESPONSE_SCRIPT);
          return;
        }

        const nextState = parseRcMusicPlayerStateMessage(
          event.nativeEvent.data,
        );
        if (nextState) {
          setPlayerState(nextState);
          setLoading(false);
          setError(false);
          publishPlaybackSummary(nextState);
          return;
        }

        try {
          const message = JSON.parse(event.nativeEvent.data);
          if (
            message?.type === 'RC_MUSIC_PLAYER_MUTE_STATE' &&
            message?.protocol === 1 &&
            typeof message.muted === 'boolean'
          ) {
            setMuted(message.muted);
          }
        } catch {
          // Ignore messages outside the two validated music bridge envelopes.
        }
      },
      [publishPlaybackSummary],
    );

    const handleNavigation = useCallback(
      (request: ShouldStartLoadRequest): boolean =>
        isRcMusicPlayerNavigationAllowed(request.url, request.isTopFrame),
      [],
    );

    const handleError = useCallback(
      (_event: WebViewErrorEvent): void => {
        setPlayerState(EMPTY_RC_MUSIC_PLAYER_STATE);
        publishPlaybackSummary(EMPTY_RC_MUSIC_PLAYER_STATE);
        setLoading(false);
        setError(true);
      },
      [publishPlaybackSummary],
    );

    const handleProgressLayout = useCallback(
      (event: LayoutChangeEvent): void => {
        setProgressWidth(event.nativeEvent.layout.width);
      },
      [],
    );

    const handleProgressPress = useCallback(
      (event: GestureResponderEvent): void => {
        if (!playerState.ready || playerState.durationMs <= 0) return;
        const pressedX = Math.max(
          0,
          Math.min(event.nativeEvent.locationX, progressWidth),
        );
        seekTo(
          (pressedX / Math.max(1, progressWidth)) * playerState.durationMs,
        );
      },
      [playerState.durationMs, playerState.ready, progressWidth, seekTo],
    );

    const controlsEnabled =
      playerState.available && playerState.ready && !error;
    const progress =
      playerState.durationMs > 0
        ? Math.min(1, playerState.positionMs / playerState.durationMs)
        : 0;
    const trackNumber =
      playerState.trackIndex !== null && playerState.trackCount !== null
        ? `${playerState.trackIndex + 1} / ${playerState.trackCount}`
        : '-- / --';

    return (
      <View
        testID="rc-music-player-host"
        pointerEvents={visible ? 'auto' : 'none'}
        accessibilityElementsHidden={!visible}
        importantForAccessibility={visible ? 'auto' : 'no-hide-descendants'}
        style={visible ? styles.overlay : styles.hiddenHost}
      >
        {visible && (
          <>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close music player"
              style={StyleSheet.absoluteFill}
              onPress={onClose}
            />

            <View style={[styles.card, isLandscape && styles.cardLandscape]}>
              <View style={styles.header}>
                <View style={styles.headerTitleGroup}>
                  <Text style={styles.eyebrow}>RELIC COMMANDER TERMINAL</Text>
                  <Text style={styles.title}>Music control</Text>
                  <Text style={styles.subtitle}>PERSISTENT AUDIO ENGINE</Text>
                </View>
                <TouchableOpacity
                  accessibilityRole="button"
                  accessibilityLabel="Refresh music state"
                  hitSlop={{ top: 8, right: 4, bottom: 8, left: 8 }}
                  style={styles.headerButton}
                  onPress={requestState}
                >
                  <MaterialCommunityIcons
                    name="refresh"
                    size={20}
                    color={RC_THEME.colors.accentBright}
                  />
                </TouchableOpacity>
                <TouchableOpacity
                  accessibilityRole="button"
                  accessibilityLabel="Close music player"
                  hitSlop={{ top: 8, right: 8, bottom: 8, left: 4 }}
                  style={styles.headerButton}
                  onPress={onClose}
                >
                  <MaterialCommunityIcons
                    name="close"
                    size={22}
                    color={RC_THEME.colors.textSecondary}
                  />
                </TouchableOpacity>
              </View>

              <View style={styles.nowPlaying}>
                <View style={styles.trackIcon}>
                  <MaterialCommunityIcons
                    name={
                      playerState.playing ? 'music-note' : 'music-note-outline'
                    }
                    size={42}
                    color={RC_THEME.colors.accentBright}
                  />
                </View>
                <View style={styles.trackMetadata}>
                  <Text style={styles.trackTitle} numberOfLines={2}>
                    {playerState.title || 'Relic Commander Music'}
                  </Text>
                  <Text style={styles.trackArtist} numberOfLines={1}>
                    {playerState.artist || 'Waiting for track metadata'}
                  </Text>
                  <Text style={styles.trackCounter}>TRACK {trackNumber}</Text>
                </View>
                <View
                  style={[
                    styles.statusBadge,
                    playerState.playing && styles.statusBadgeActive,
                  ]}
                >
                  {loading && !error && (
                    <ActivityIndicator
                      size="small"
                      color={RC_THEME.colors.accentBright}
                    />
                  )}
                  <Text style={styles.statusText} numberOfLines={1}>
                    {statusLabel(playerState, error)}
                  </Text>
                </View>
              </View>

              <View style={styles.timeline}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Music progress"
                  accessibilityHint="Tap to seek"
                  accessibilityValue={{
                    min: 0,
                    max: playerState.durationMs,
                    now: playerState.positionMs,
                    text: `${formatTime(
                      playerState.positionMs,
                    )} of ${formatTime(playerState.durationMs)}`,
                  }}
                  disabled={!controlsEnabled || playerState.durationMs <= 0}
                  hitSlop={{ top: 10, right: 0, bottom: 10, left: 0 }}
                  style={styles.progressTrack}
                  onLayout={handleProgressLayout}
                  onPress={handleProgressPress}
                >
                  <View
                    pointerEvents="none"
                    style={[
                      styles.progressFill,
                      { width: `${progress * 100}%` },
                    ]}
                  />
                </Pressable>
                <View style={styles.timeRow}>
                  <Text style={styles.timeText}>
                    {formatTime(playerState.positionMs)}
                  </Text>
                  <Text style={styles.timeText}>
                    {formatTime(playerState.durationMs)}
                  </Text>
                </View>
              </View>

              <View style={styles.controls}>
                <TouchableOpacity
                  accessibilityRole="button"
                  accessibilityLabel="Previous track"
                  disabled={!controlsEnabled}
                  style={[
                    styles.controlButton,
                    !controlsEnabled && styles.controlButtonDisabled,
                  ]}
                  onPress={() => runPlayerCommand('previous')}
                >
                  <MaterialCommunityIcons
                    name="skip-previous"
                    size={32}
                    color={RC_THEME.colors.textPrimary}
                  />
                </TouchableOpacity>

                <TouchableOpacity
                  accessibilityRole="button"
                  accessibilityLabel={playerState.playing ? 'Pause' : 'Play'}
                  disabled={!controlsEnabled}
                  style={[
                    styles.playButton,
                    !controlsEnabled && styles.controlButtonDisabled,
                  ]}
                  onPress={() => runPlayerCommand('toggle')}
                >
                  <MaterialCommunityIcons
                    name={playerState.playing ? 'pause' : 'play'}
                    size={40}
                    color={RC_THEME.colors.textInverse}
                  />
                </TouchableOpacity>

                <TouchableOpacity
                  accessibilityRole="button"
                  accessibilityLabel="Next track"
                  disabled={!controlsEnabled}
                  style={[
                    styles.controlButton,
                    !controlsEnabled && styles.controlButtonDisabled,
                  ]}
                  onPress={() => runPlayerCommand('next')}
                >
                  <MaterialCommunityIcons
                    name="skip-next"
                    size={32}
                    color={RC_THEME.colors.textPrimary}
                  />
                </TouchableOpacity>

                <TouchableOpacity
                  accessibilityRole="button"
                  accessibilityLabel={muted ? 'Unmute music' : 'Mute music'}
                  disabled={!playerState.available || error}
                  style={[
                    styles.controlButton,
                    (!playerState.available || error) &&
                      styles.controlButtonDisabled,
                  ]}
                  onPress={toggleMuted}
                >
                  <MaterialCommunityIcons
                    name={muted ? 'volume-off' : 'volume-high'}
                    size={28}
                    color={
                      muted
                        ? RC_THEME.colors.textMuted
                        : RC_THEME.colors.accentBright
                    }
                  />
                </TouchableOpacity>
              </View>

              <View style={styles.preferenceRow}>
                <MaterialCommunityIcons
                  name="eye-off-outline"
                  size={24}
                  color={RC_THEME.colors.accentBright}
                />
                <View style={styles.preferenceText}>
                  <Text style={styles.preferenceLabel}>
                    Hide the music icon
                  </Text>
                  <Text style={styles.preferenceHint}>
                    Keep music controls available only inside Quick Settings.
                  </Text>
                </View>
                <Switch
                  accessibilityLabel="Hide the music icon"
                  value={hideMusicIcon}
                  onValueChange={onHideMusicIconChange}
                  trackColor={{
                    false: RC_THEME.colors.surfaceElevated,
                    true: RC_THEME.colors.primary,
                  }}
                  thumbColor={
                    hideMusicIcon
                      ? RC_THEME.colors.accentBright
                      : RC_THEME.colors.textMuted
                  }
                />
              </View>

              {error && (
                <View style={styles.errorRow}>
                  <MaterialCommunityIcons
                    name="alert-circle-outline"
                    size={20}
                    color={RC_THEME.colors.danger}
                  />
                  <Text style={styles.errorText}>
                    Music is unavailable. Check Wi-Fi and try again.
                  </Text>
                  <TouchableOpacity
                    style={styles.retryButton}
                    onPress={resetPlayer}
                  >
                    <Text style={styles.retryText}>Retry</Text>
                  </TouchableOpacity>
                </View>
              )}
            </View>
          </>
        )}

        <View style={styles.engineHost} pointerEvents="none">
          <WebView
            key={`rc-music-player-${webViewGeneration}`}
            ref={webViewRef}
            source={{ uri: RC_TERMINAL_MUSIC_PLAYER }}
            style={styles.webView}
            originWhitelist={['*']}
            javaScriptEnabled
            domStorageEnabled
            sharedCookiesEnabled
            thirdPartyCookiesEnabled
            cacheEnabled
            cacheMode="LOAD_DEFAULT"
            mixedContentMode="never"
            mediaPlaybackRequiresUserAction={false}
            allowsInlineMediaPlayback
            allowsFullscreenVideo={false}
            setSupportMultipleWindows={false}
            setBuiltInZoomControls={false}
            setDisplayZoomControls={false}
            allowFileAccess={false}
            allowFileAccessFromFileURLs={false}
            allowUniversalAccessFromFileURLs={false}
            mediaCapturePermissionGrantType="deny"
            onShouldStartLoadWithRequest={handleNavigation}
            onNavigationStateChange={navigation => {
              if (!isRcMusicPlayerNavigationAllowed(navigation.url, true)) {
                resetPlayer();
              }
            }}
            injectedJavaScript={MUSIC_API_BOOTSTRAP_SCRIPT}
            onMessage={handleMessage}
            onLoadStart={() => {
              setLoading(true);
              setError(false);
            }}
            onLoadEnd={() => {
              setLoading(false);
              requestState();
            }}
            onError={handleError}
          />
        </View>
      </View>
    );
  },
);

RelicCommanderMusicPlayer.displayName = 'RelicCommanderMusicPlayer';

export default RelicCommanderMusicPlayer;

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 1300,
    elevation: 12,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    backgroundColor: RC_THEME.colors.overlay,
  },
  hiddenHost: {
    position: 'absolute',
    top: -2,
    left: -2,
    width: 1,
    height: 1,
    opacity: 0,
    overflow: 'hidden',
  },
  engineHost: {
    position: 'absolute',
    top: -2,
    left: -2,
    width: 1,
    height: 1,
    opacity: 0,
    overflow: 'hidden',
  },
  webView: {
    width: 1,
    height: 1,
    backgroundColor: RC_THEME.colors.surfaceCardDeep,
  },
  card: {
    width: '92%',
    maxWidth: 680,
    padding: 18,
    borderWidth: 1,
    borderColor: RC_THEME.colors.borderStrong,
    borderRadius: RC_THEME.radius.large,
    backgroundColor: RC_THEME.colors.surfaceCard,
    ...RC_THEME.shadow.card,
  },
  cardLandscape: {
    width: '76%',
    maxWidth: 760,
  },
  header: {
    minHeight: 54,
    marginBottom: 18,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  headerTitleGroup: {
    flex: 1,
  },
  eyebrow: {
    marginBottom: 3,
    color: RC_THEME.colors.primary,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.8,
  },
  title: {
    color: RC_THEME.colors.textPrimary,
    fontSize: 19,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  subtitle: {
    marginTop: 4,
    color: RC_THEME.colors.textMuted,
    fontSize: 11,
    letterSpacing: 1.2,
  },
  headerButton: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: RC_THEME.colors.border,
    borderRadius: RC_THEME.radius.pill,
    backgroundColor: RC_THEME.colors.surfaceInput,
  },
  nowPlaying: {
    minHeight: 116,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: RC_THEME.colors.border,
    borderRadius: RC_THEME.radius.medium,
    backgroundColor: RC_THEME.colors.surfaceCardDeep,
  },
  trackIcon: {
    width: 72,
    height: 72,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: RC_THEME.colors.primary,
    borderRadius: RC_THEME.radius.medium,
    backgroundColor: RC_THEME.colors.surfaceAccent,
  },
  trackMetadata: {
    flex: 1,
    minWidth: 0,
  },
  trackTitle: {
    color: RC_THEME.colors.textPrimary,
    fontSize: 18,
    fontWeight: '700',
  },
  trackArtist: {
    marginTop: 5,
    color: RC_THEME.colors.textSecondary,
    fontSize: 13,
  },
  trackCounter: {
    marginTop: 9,
    color: RC_THEME.colors.textMuted,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.1,
  },
  statusBadge: {
    maxWidth: 126,
    minHeight: 30,
    paddingHorizontal: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderWidth: 1,
    borderColor: RC_THEME.colors.borderStrong,
    borderRadius: RC_THEME.radius.pill,
    backgroundColor: RC_THEME.colors.surface,
  },
  statusBadgeActive: {
    borderColor: RC_THEME.colors.primary,
    backgroundColor: RC_THEME.colors.surfaceAccent,
  },
  statusText: {
    color: RC_THEME.colors.accentBright,
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 0.7,
  },
  timeline: {
    marginTop: 20,
  },
  progressTrack: {
    height: 12,
    justifyContent: 'center',
    overflow: 'hidden',
    borderRadius: RC_THEME.radius.pill,
    backgroundColor: RC_THEME.colors.surfaceElevated,
  },
  progressFill: {
    height: '100%',
    borderRadius: RC_THEME.radius.pill,
    backgroundColor: RC_THEME.colors.primaryGlow,
  },
  timeRow: {
    marginTop: 6,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  timeText: {
    color: RC_THEME.colors.textMuted,
    fontSize: 11,
    fontVariant: ['tabular-nums'],
  },
  controls: {
    marginTop: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 14,
  },
  controlButton: {
    width: 54,
    height: 54,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: RC_THEME.colors.borderStrong,
    borderRadius: RC_THEME.radius.pill,
    backgroundColor: RC_THEME.colors.surface,
  },
  playButton: {
    width: 68,
    height: 68,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: RC_THEME.radius.pill,
    backgroundColor: RC_THEME.colors.primary,
    ...RC_THEME.shadow.glow,
  },
  controlButtonDisabled: {
    opacity: 0.38,
  },
  preferenceRow: {
    minHeight: 64,
    marginTop: 20,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: RC_THEME.colors.border,
    borderRadius: RC_THEME.radius.medium,
    backgroundColor: RC_THEME.colors.surfaceCardDeep,
  },
  preferenceText: {
    flex: 1,
    minWidth: 0,
  },
  preferenceLabel: {
    color: RC_THEME.colors.textPrimary,
    fontSize: 13,
    fontWeight: '700',
  },
  preferenceHint: {
    marginTop: 3,
    color: RC_THEME.colors.textMuted,
    fontSize: 11,
    lineHeight: 15,
  },
  errorRow: {
    marginTop: 18,
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 10,
    borderRadius: RC_THEME.radius.medium,
    backgroundColor: RC_THEME.colors.dangerBackground,
  },
  errorText: {
    flex: 1,
    color: RC_THEME.colors.textSecondary,
    fontSize: 12,
  },
  retryButton: {
    minHeight: 34,
    paddingHorizontal: 13,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: RC_THEME.radius.small,
    backgroundColor: RC_THEME.colors.primary,
  },
  retryText: {
    color: RC_THEME.colors.textInverse,
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
});
