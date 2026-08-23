import React, { useCallback, useRef, useState } from 'react';
import {
  ActivityIndicator,
  NativeModules,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import { WebView } from 'react-native-webview';
import type {
  ShouldStartLoadRequest,
  WebViewErrorEvent,
} from 'react-native-webview/lib/WebViewTypes';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import { RC_THEME } from '../theme/relicCommanderTheme';
import {
  buildRcTerminalCapabilitiesResponseScript,
  isRcMusicPlayerNavigationAllowed,
  isRcTerminalCapabilitiesRequest,
  isRelicCommanderUrl,
  RC_TERMINAL_MUSIC_PLAYER,
} from '../utils/rcTerminalBridge';

interface Props {
  visible: boolean;
  onClose: () => void;
}

const { UpdateModule } = NativeModules;

const CAPABILITIES_RESPONSE_SCRIPT = buildRcTerminalCapabilitiesResponseScript(
  UpdateModule?.VERSION_NAME,
);

/**
 * Persistent, customer-safe SoundCloud player for Relic Commander.
 *
 * KioskScreen creates this component only after the first explicit Music action.
 * Closing the panel keeps its WebView mounted in a 1x1 attached host so playback
 * and page state survive while the player UI is in the background.
 */
export default function RelicCommanderMusicPlayer({ visible, onClose }: Props) {
  const webViewRef = useRef<WebView>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const { width, height } = useWindowDimensions();
  const isLandscape = width > height;

  const returnToPlayer = useCallback((): void => {
    webViewRef.current?.stopLoading();
    webViewRef.current?.injectJavaScript(
      `window.location.replace(${JSON.stringify(
        RC_TERMINAL_MUSIC_PLAYER,
      )}); true;`,
    );
  }, []);

  const handleMessage = useCallback((event: any): void => {
    if (
      isRelicCommanderUrl(event.nativeEvent.url) &&
      isRcTerminalCapabilitiesRequest(event.nativeEvent.data)
    ) {
      webViewRef.current?.injectJavaScript(CAPABILITIES_RESPONSE_SCRIPT);
    }
  }, []);

  const handleNavigation = useCallback(
    (request: ShouldStartLoadRequest): boolean => {
      if (isRcMusicPlayerNavigationAllowed(request.url, request.isTopFrame)) {
        return true;
      }

      returnToPlayer();
      return false;
    },
    [returnToPlayer],
  );

  const handleError = useCallback((_event: WebViewErrorEvent): void => {
    setLoading(false);
    setError(true);
  }, []);

  const retry = useCallback((): void => {
    setError(false);
    setLoading(true);
    webViewRef.current?.reload();
  }, []);

  return (
    <View
      testID="rc-music-player-host"
      pointerEvents={visible ? 'auto' : 'none'}
      accessibilityElementsHidden={!visible}
      importantForAccessibility={visible ? 'auto' : 'no-hide-descendants'}
      style={visible ? styles.overlay : styles.hiddenHost}
    >
      {visible && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close music player"
          style={StyleSheet.absoluteFill}
          onPress={onClose}
        />
      )}

      <View
        style={[
          visible ? styles.card : styles.hiddenCard,
          visible && isLandscape && styles.cardLandscape,
        ]}
      >
        {visible && (
          <View style={styles.header}>
            <View style={styles.headerTitleGroup}>
              <Text style={styles.eyebrow}>RELIC COMMANDER TERMINAL</Text>
              <Text style={styles.title}>Music</Text>
              <Text style={styles.subtitle}>PERSISTENT PLAYER</Text>
            </View>
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel="Close music player"
              hitSlop={{ top: 8, right: 8, bottom: 8, left: 8 }}
              style={styles.closeButton}
              onPress={onClose}
            >
              <MaterialCommunityIcons
                name="close"
                size={22}
                color={RC_THEME.colors.textSecondary}
              />
            </TouchableOpacity>
          </View>
        )}

        <View style={visible ? styles.playerFrame : styles.hiddenPlayerFrame}>
          <WebView
            ref={webViewRef}
            source={{ uri: RC_TERMINAL_MUSIC_PLAYER }}
            style={styles.webView}
            // Route every scheme through handleNavigation. A narrower whitelist
            // would ask React Native Linking to open rejected schemes externally.
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
                returnToPlayer();
              }
            }}
            onMessage={handleMessage}
            onLoadStart={() => {
              setLoading(true);
              setError(false);
            }}
            onLoadEnd={() => setLoading(false)}
            onError={handleError}
          />

          {visible && loading && !error && (
            <View style={styles.stateOverlay} pointerEvents="none">
              <ActivityIndicator
                size="large"
                color={RC_THEME.colors.accentBright}
              />
              <Text style={styles.stateText}>Loading music player…</Text>
            </View>
          )}

          {visible && error && (
            <View style={styles.stateOverlay}>
              <MaterialCommunityIcons
                name="music-off"
                size={34}
                color={RC_THEME.colors.danger}
              />
              <Text style={styles.errorTitle}>Music unavailable</Text>
              <Text style={styles.stateText}>
                Check the Wi-Fi connection, then try again.
              </Text>
              <TouchableOpacity style={styles.retryButton} onPress={retry}>
                <MaterialCommunityIcons
                  name="refresh"
                  size={18}
                  color={RC_THEME.colors.textInverse}
                />
                <Text style={styles.retryText}>Try again</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      </View>
    </View>
  );
}

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
  card: {
    width: '92%',
    height: '68%',
    maxWidth: 760,
    maxHeight: 620,
    padding: 16,
    borderWidth: 1,
    borderColor: RC_THEME.colors.borderStrong,
    borderRadius: RC_THEME.radius.large,
    backgroundColor: RC_THEME.colors.surfaceCard,
    ...RC_THEME.shadow.card,
  },
  cardLandscape: {
    width: '82%',
    height: '80%',
    maxWidth: 900,
  },
  hiddenCard: {
    width: 1,
    height: 1,
    overflow: 'hidden',
  },
  header: {
    minHeight: 54,
    marginBottom: 12,
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
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
  closeButton: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: RC_THEME.colors.border,
    borderRadius: RC_THEME.radius.pill,
    backgroundColor: RC_THEME.colors.surfaceInput,
  },
  playerFrame: {
    flex: 1,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: RC_THEME.colors.border,
    borderRadius: RC_THEME.radius.medium,
    backgroundColor: RC_THEME.colors.surfaceCardDeep,
  },
  hiddenPlayerFrame: {
    width: 1,
    height: 1,
    overflow: 'hidden',
  },
  webView: {
    flex: 1,
    backgroundColor: RC_THEME.colors.surfaceCardDeep,
  },
  stateOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    backgroundColor: RC_THEME.colors.surfaceCardDeep,
  },
  stateText: {
    marginTop: 12,
    color: RC_THEME.colors.textMuted,
    fontSize: 13,
    textAlign: 'center',
  },
  errorTitle: {
    marginTop: 10,
    color: RC_THEME.colors.textPrimary,
    fontSize: 17,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  retryButton: {
    minHeight: 42,
    marginTop: 18,
    paddingHorizontal: 18,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: RC_THEME.radius.medium,
    backgroundColor: RC_THEME.colors.primary,
  },
  retryText: {
    color: RC_THEME.colors.textInverse,
    fontSize: 13,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
});
