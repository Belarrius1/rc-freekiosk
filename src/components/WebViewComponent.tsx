import React, {
  useRef,
  useState,
  useMemo,
  useCallback,
  useImperativeHandle,
  forwardRef,
} from 'react';
import {
  View,
  StyleSheet,
  ActivityIndicator,
  Text,
  TouchableOpacity,
  Image,
  NativeModules,
  findNodeHandle,
  useWindowDimensions,
} from 'react-native';

import KioskModule from '../utils/KioskModule';
import { WebView } from 'react-native-webview';
import type {
  WebViewErrorEvent,
  ShouldStartLoadRequest,
  WebViewRenderProcessGoneEvent,
} from 'react-native-webview/lib/WebViewTypes';
import PrintModule from '../utils/PrintModule';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import { RC_THEME } from '../theme/relicCommanderTheme';
import {
  buildRcTerminalCapabilitiesResponseScript,
  isRcTerminalCapabilitiesRequest,
  isRelicCommanderUrl,
  RC_TERMINAL_HOME,
  shouldReturnToRcHome,
} from '../utils/rcTerminalBridge';

const { HttpServerModule, UpdateModule } = NativeModules;

const RC_TERMINAL_CAPABILITIES_RESPONSE_SCRIPT =
  buildRcTerminalCapabilitiesResponseScript(UpdateModule?.VERSION_NAME);

interface WebViewComponentProps {
  url: string;
  autoReload: boolean;
  keyboardMode?: string; // 'default', 'force_numeric', 'smart'
  onUserInteraction?: (event?: {
    isTap?: boolean;
    x?: number;
    y?: number;
    fromAdminHotspot?: boolean;
  }) => void; // callback optionnel pour interaction utilisateur
  jsToExecute?: string; // JavaScript code to execute from API
  onJsExecuted?: () => void; // callback when JS is executed
  showBackButton?: boolean; // Enable web navigation back button
  onNavigationStateChange?: (state: {
    canGoBack: boolean;
    canGoForward: boolean;
    title: string;
  }) => void; // Callback for web navigation state
  onPageNavigated?: (url: string) => void; // Callback when page URL changes (for inactivity return)
  onOpenWifiSettings?: () => void; // Open the customer-safe in-app Wi-Fi controls
  urlFilterMode?: string; // 'whitelist' or 'blacklist'
  urlFilterPatterns?: string[]; // URL patterns to filter
  urlFilterShowFeedback?: boolean; // Show feedback when URL is blocked
  pdfViewerEnabled?: boolean; // Enable inline PDF viewing via PDF.js
  printEnabled?: boolean; // Enable window.print() interception for native printing
  printPaperSize?: string; // Default paper size: 'A4' | 'A5' | 'A3' | 'LETTER' | 'LEGAL'
  disableUserZoom?: boolean; // Prevent pinch-to-zoom and double-tap zoom
  customUserAgent?: string; // Custom User-Agent string (empty = native Android WebView UA)
  basicAuthCredential?: { username: string; password: string };
  onRenderProcessGone?: (didCrash: boolean) => void; // #198 — renderer process died, ask parent to remount
}

export interface WebViewComponentRef {
  goBack: () => void;
  goForward: () => void;
  reload: () => void;
  navigateToRelicCommanderHome: () => void;
  scrollToTop: () => void;
  clearCache: () => void;
  pauseMedia: () => void;
  resumeMedia: () => void;
}

// #177 — Pause any HTML5 media playing in the page. Injected on pause as a reliable
// complement to the native WebView.onPause() (which alone doesn't stop <audio> on every
// OEM WebView). Ends with `true;` to silence react-native-webview's injection warning.
const MEDIA_PAUSE_JS = `(function(){try{document.querySelectorAll('audio,video').forEach(function(m){try{m.pause();}catch(e){}});}catch(e){}})();true;`;

const WebViewComponent = forwardRef<WebViewComponentRef, WebViewComponentProps>(
  (
    {
      url,
      autoReload,
      keyboardMode = 'default',
      onUserInteraction,
      jsToExecute,
      onJsExecuted,
      showBackButton = false,
      onNavigationStateChange,
      onPageNavigated,
      onOpenWifiSettings,
      urlFilterMode,
      urlFilterPatterns,
      urlFilterShowFeedback = false,
      pdfViewerEnabled = false,
      printEnabled = false,
      printPaperSize = 'A4',
      disableUserZoom = false,
      customUserAgent = '',
      basicAuthCredential,
      onRenderProcessGone,
    },
    ref,
  ) => {
    const { width, height } = useWindowDimensions();
    const isLandscape = width > height;
    const webViewRef = useRef<WebView>(null);
    // #190 — Host-view ref for pauseMedia/resumeMedia. react-native-webview's ref is a
    // methods-only imperative handle, NOT a ReactComponent: passing it to findNodeHandle
    // throws and crashes the app (JavascriptException on screensaver activation). The
    // native pauseWebView() walks the subtree for the WebView, so the container's tag works.
    const containerViewRef = useRef<View>(null);
    const [loading, setLoading] = useState<boolean>(true);
    const [error, setError] = useState<boolean>(false);
    const [pageLoaded, setPageLoaded] = useState<boolean>(false);
    const [blockedUrlMessage, setBlockedUrlMessage] = useState<string | null>(
      null,
    );
    const blockedUrlTimerRef = useRef<any>(null);
    const isGoingBackRef = useRef<boolean>(false); // Prevent goBack loop for URL filter
    const loadingTimeoutRef = useRef<any>(null);
    // Last top-frame (main document) URL requested — used to distinguish a fatal
    // main-page HTTP error from a harmless sub-resource error (favicon, analytics…).
    const lastTopFrameUrlRef = useRef<string | null>(null);

    // Pre-compile URL filter patterns into RegExp for performance
    const compiledFilterPatterns = useMemo(() => {
      if (!urlFilterPatterns || urlFilterPatterns.length === 0) return [];
      return urlFilterPatterns
        .map(pattern => {
          try {
            // Strip leading/trailing whitespace
            let p = pattern.trim();
            if (!p) return null;

            // Escape regex special chars except *, then convert * to .*
            const escaped = p
              .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
              .replace(/\*/g, '.*');

            // If the pattern already starts with a protocol (http/https), anchor it
            // Otherwise, allow any protocol prefix and make trailing slash optional
            const hasProtocol = /^https?:\/\//i.test(p);
            if (hasProtocol) {
              // Exact match with optional trailing slash
              return new RegExp(`^${escaped}\\/?$`, 'i');
            } else {
              // No protocol: allow https?:// prefix, optional trailing slash
              return new RegExp(`^https?:\\/\\/${escaped}\\/?$`, 'i');
            }
          } catch {
            return null;
          }
        })
        .filter(Boolean) as RegExp[];
    }, [urlFilterPatterns]);

    // Check if a URL should be blocked by the filter
    const isUrlBlocked = useCallback(
      (targetUrl: string): boolean => {
        if (!urlFilterMode) return false;

        // Blacklist with empty list = nothing to block
        if (
          urlFilterMode === 'blacklist' &&
          compiledFilterPatterns.length === 0
        )
          return false;

        // Helper: extract origin + pathname (without query/hash), normalize trailing slash
        const getOriginPath = (u: string): string => {
          const m = u.match(/^(https?:\/\/[^/?#]+)([^?#]*)/i);
          if (!m) return u.toLowerCase();
          let path = m[2] || '/';
          // Normalize: add leading /, remove trailing / (except for root)
          if (!path.startsWith('/')) path = '/' + path;
          if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1);
          return (m[1] + path).toLowerCase();
        };

        // Always allow navigation to the same page (same origin + path)
        // This allows form submits, JS buttons, hash/query changes on the SAME page
        const targetOriginPath = getOriginPath(targetUrl);
        const mainOriginPath = getOriginPath(url);

        if (targetOriginPath === mainOriginPath) return false;

        if (urlFilterMode === 'blacklist') {
          // Blacklist: block if URL matches any pattern
          return compiledFilterPatterns.some(regex => regex.test(targetUrl));
        } else {
          // Whitelist: block everything except same-page + matched patterns
          // Empty list = only same-page allowed (strictest mode)
          if (compiledFilterPatterns.length === 0) return true;
          // Check if target matches any whitelist pattern
          if (compiledFilterPatterns.some(regex => regex.test(targetUrl)))
            return false;
          // No match = blocked
          return true;
        }
      },
      [urlFilterMode, compiledFilterPatterns, url],
    );

    // Show brief feedback when URL is blocked
    const showBlockedFeedback = useCallback(
      (blockedUrl: string) => {
        if (!urlFilterShowFeedback) return;
        // Extract hostname from URL using regex (avoid URL constructor type issues in RN)
        const hostMatch = blockedUrl.match(/^https?:\/\/([^/]+)/);
        const hostname = hostMatch ? hostMatch[1] : blockedUrl;
        setBlockedUrlMessage(`🚫 ${hostname}`);
        if (blockedUrlTimerRef.current)
          clearTimeout(blockedUrlTimerRef.current);
        blockedUrlTimerRef.current = setTimeout(
          () => setBlockedUrlMessage(null),
          2000,
        );
      },
      [urlFilterShowFeedback],
    );

    const returnToRelicCommanderHome = useCallback((): void => {
      setError(false);
      setLoading(true);
      setPageLoaded(false);
      lastTopFrameUrlRef.current = RC_TERMINAL_HOME;
      isGoingBackRef.current = false;
      webViewRef.current?.stopLoading();
      webViewRef.current?.injectJavaScript(
        `window.location.replace(${JSON.stringify(RC_TERMINAL_HOME)}); true;`,
      );
    }, []);

    // Expose goBack, scrollToTop, and clearCache methods to parent via ref
    useImperativeHandle(ref, () => ({
      goBack: () => {
        if (webViewRef.current) {
          webViewRef.current.goBack();
        }
      },
      goForward: () => {
        if (webViewRef.current) {
          webViewRef.current.goForward();
        }
      },
      reload: () => {
        if (webViewRef.current) {
          webViewRef.current.reload();
        }
      },
      navigateToRelicCommanderHome: returnToRelicCommanderHome,
      scrollToTop: () => {
        if (webViewRef.current) {
          webViewRef.current.injectJavaScript(
            'window.scrollTo({top: 0, behavior: "smooth"}); true;',
          );
        }
      },
      clearCache: () => {
        if (webViewRef.current) {
          webViewRef.current.clearCache(true);
          console.log('[WebView] Cache cleared via ref');
        }
      },
      // #177 — Stop background audio/video when the page is hidden (screensaver / screen off
      // / app backgrounded). JS-level pause of <audio>/<video> + native renderer suspend.
      pauseMedia: () => {
        const wv = webViewRef.current;
        if (!wv) return;
        wv.injectJavaScript(MEDIA_PAUSE_JS);
        // #190 — resolve the tag from the container host view, never from the WebView ref
        // (a methods-only imperative handle that makes findNodeHandle throw → app crash)
        try {
          const node = findNodeHandle(containerViewRef.current);
          if (node != null) {
            KioskModule.pauseWebView?.(node).catch(() => {});
          }
        } catch {}
      },
      // Resume only re-enables the WebView renderer; media is intentionally left paused so
      // audio doesn't auto-restart on its own (the page/user decides).
      resumeMedia: () => {
        const wv = webViewRef.current;
        if (!wv) return;
        try {
          const node = findNodeHandle(containerViewRef.current);
          if (node != null) {
            KioskModule.resumeWebView?.(node).catch(() => {});
          }
        } catch {}
      },
    }));

    // Execute JavaScript from API — with retry if page is still loading
    React.useEffect(() => {
      if (!jsToExecute || !webViewRef.current) return;

      if (!loading) {
        // Page ready, inject immediately
        webViewRef.current.injectJavaScript(jsToExecute);
        console.log('[WebView] Executed JS from API');
        if (onJsExecuted) {
          onJsExecuted();
        }
      } else {
        // Page still loading — retry after a short delay (up to 5 seconds)
        console.log('[WebView] Page still loading, deferring JS execution...');
        let attempts = 0;
        const maxAttempts = 10;
        const retryInterval = setInterval(() => {
          attempts++;
          if (webViewRef.current && !loading) {
            clearInterval(retryInterval);
            webViewRef.current.injectJavaScript(jsToExecute);
            console.log(
              '[WebView] Executed deferred JS from API after',
              attempts,
              'retries',
            );
            if (onJsExecuted) {
              onJsExecuted();
            }
          } else if (attempts >= maxAttempts) {
            clearInterval(retryInterval);
            console.warn(
              '[WebView] Gave up executing JS after',
              maxAttempts,
              'retries (page still loading)',
            );
            if (onJsExecuted) {
              onJsExecuted();
            }
          }
        }, 500);
        return () => clearInterval(retryInterval);
      }
    }, [jsToExecute, loading, onJsExecuted]);

    // Cleanup loading timeout on unmount
    React.useEffect(() => {
      return () => {
        if (loadingTimeoutRef.current) {
          clearTimeout(loadingTimeoutRef.current);
        }
      };
    }, []);

    // Injection JS pour détecter les clics dans la webview
    // Optimisé pour Fire OS : throttling des événements, protection double-init
    const injectedJavaScript = `
    (function() {
    // Protection contre double exécution (important pour Fire OS)
    if (window.__FREEKIOSK_INITIALIZED__) {
      return;
    }
    window.__FREEKIOSK_INITIALIZED__ = true;

    // Ensure storage is working properly
    try {
      localStorage.setItem('__test__', '1');
      localStorage.removeItem('__test__');
    } catch(e) {
      console.error('[FreeKiosk] localStorage FAILED:', e);
    }

    // Intercept window.print() to use native Android print (only when printing is enabled)
    ${
      printEnabled
        ? `
    window.print = function() {
      window.ReactNativeWebView.postMessage(JSON.stringify({
        type: 'PRINT_REQUEST',
        title: document.title || '',
        paperSize: '${printPaperSize}'
      }));
    };
    `
        : '// Printing disabled - window.print() not intercepted'
    }

    // Throttling pour éviter le flood de messages (critique sur Fire OS)
    let lastInteraction = 0;
    const THROTTLE_MS = 200; // Max 5 messages/sec

    function sendInteraction() {
      const now = Date.now();
      if (now - lastInteraction > THROTTLE_MS) {
        window.ReactNativeWebView.postMessage('user-interaction');
        lastInteraction = now;
      }
    }

    // Tap detection for 5-tap - Use touchend on mobile (click doesn't always fire)
    // Send coordinates for spatial proximity detection
    document.addEventListener('touchend', function(e) {
      if (e.changedTouches && e.changedTouches.length > 0) {
        var touch = e.changedTouches[0];
        window.ReactNativeWebView.postMessage(JSON.stringify({
          type: 'FIVE_TAP_CLICK',
          x: touch.clientX,
          y: touch.clientY
        }));
      }
    }, true);
    
    // Click handler for desktop/fallback - Also send user-interaction for screensaver reset
    document.addEventListener('click', function(e) {
      sendInteraction();
    }, true);

    // Scroll avec throttling (évite 50+ msg/sec)
    document.addEventListener('scroll', sendInteraction, true);

    // Touch events avec throttling (for screensaver only, not for tap counting)
    document.addEventListener('touchstart', sendInteraction, true);
    document.addEventListener('touchmove', sendInteraction, true);

    // Keyboard / text input events — typing with the on-screen keyboard does NOT
    // produce touch/scroll/click events, so without these the inactivity timer
    // (screensaver + "Return to Start Page") keeps counting down while the user is
    // typing into a text field. Android soft keyboards with predictive text fire
    // 'keydown' with keyCode 229 and often skip per-character key events, but
    // 'input' and 'compositionupdate' fire reliably for every character, so we
    // listen to all of them (throttled via sendInteraction).
    document.addEventListener('keydown', sendInteraction, true);
    document.addEventListener('input', sendInteraction, true);
    document.addEventListener('compositionupdate', sendInteraction, true);

    // ==================== speechSynthesis Polyfill ====================
    // Android WebView does not implement the Web Speech API (speechSynthesis).
    // This polyfill bridges window.speechSynthesis.speak() to FreeKiosk's native
    // Android TextToSpeech engine via postMessage → React Native → NativeModules.
    // It also enumerates real TTS voices (Google TTS etc.) via async query.
    // This allows web apps that use TTS to work transparently in kiosk mode.
    (function() {
      // Only polyfill if speechSynthesis is missing or non-functional
      if (window.speechSynthesis && typeof window.speechSynthesis.speak === 'function') {
        try {
          var testVoices = window.speechSynthesis.getVoices();
          // If native implementation returns voices, it might be real. Still polyfill
          // because Android WebView speechSynthesis is notoriously broken (returns
          // voices but speak() is a no-op). Only skip if there are > 2 voices.
          if (testVoices && testVoices.length > 2) return;
        } catch(e) {}
      }

      var _fkVoices = [];
      var _fkVoicesLoaded = false;
      var _fkVoicesChangedCbs = [];
      var _fkSpeaking = false;
      var _fkEndTimer = null;
      var _fkPendingSpeak = null;  // utterance queued while voices not yet loaded

      // Request real TTS voices from native Android
      function _fkLoadVoices() {
        window.ReactNativeWebView.postMessage(JSON.stringify({
          type: 'SPEECH_SYNTH_GET_VOICES'
        }));
      }

      // Called from native via injectJavaScript when voices are ready
      window.__fkSetVoices = function(voicesJson) {
        try {
          var voices = JSON.parse(voicesJson);
          _fkVoices = voices.map(function(v, i) {
            return {
              default: v.default || (i === 0),
              lang: v.lang || 'en-US',
              localService: v.localService !== false,
              name: v.name || ('Voice ' + i),
              voiceURI: v.voiceUri || v.name || ('voice-' + i)
            };
          });
          _fkVoicesLoaded = true;
          // Fire voiceschanged event for each registered callback
          var evt = new Event('voiceschanged');
          _fkVoicesChangedCbs.forEach(function(cb) { try { cb(evt); } catch(e) {} });
          _fkVoicesChangedCbs = [];
          // If an utterance was queued before voices loaded, speak it now
          if (_fkPendingSpeak) {
            var u = _fkPendingSpeak;
            _fkPendingSpeak = null;
            synth.speak(u);
          }
        } catch(e) {
          console.error('[FreeKiosk] Failed to parse voices:', e);
        }
      };

      function FKSpeechSynthesisUtterance(text) {
        this.text = text || '';
        this.lang = '';
        this.pitch = 1;
        this.rate = 1;
        this.volume = 1;
        this.voice = null;
        this.onstart = null;
        this.onend = null;
        this.onerror = null;
        this.onpause = null;
        this.onresume = null;
        this.onmark = null;
        this.onboundary = null;
      }
      window.SpeechSynthesisUtterance = FKSpeechSynthesisUtterance;

      var synth = {
        speaking: false,
        pending: false,
        paused: false,
        speak: function(utterance) {
          if (!utterance || !utterance.text) return;
          // If voices not yet loaded, queue the utterance
          if (!_fkVoicesLoaded) {
            _fkPendingSpeak = utterance;
            _fkLoadVoices();
            return;
          }
          this.speaking = true;
          _fkSpeaking = true;
          // Pick the best voice: use utterance.voice if set, else find matching lang
          var voiceUri = '';
          var lang = utterance.lang || '';
          if (utterance.voice && utterance.voice.voiceURI) {
            voiceUri = utterance.voice.voiceURI;
            lang = utterance.voice.lang || lang;
          } else if (lang) {
            // Find a voice matching the requested language
            var exactMatch = _fkVoices.find(function(v) { return v.lang === lang; });
            var prefixMatch = _fkVoices.find(function(v) { return v.lang.indexOf(lang.split('-')[0]) === 0; });
            var bestVoice = exactMatch || prefixMatch || (utterance.voice || (_fkVoices[0] || null));
            if (bestVoice && bestVoice.voiceURI) {
              voiceUri = bestVoice.voiceURI;
              lang = bestVoice.lang || lang;
            }
          }
          window.ReactNativeWebView.postMessage(JSON.stringify({
            type: 'SPEECH_SYNTH_SPEAK',
            text: utterance.text,
            lang: lang,
            voiceUri: voiceUri,
            rate: utterance.rate || 1,
            pitch: utterance.pitch || 1,
            volume: utterance.volume || 1
          }));
          if (utterance.onstart) {
            try { utterance.onstart(new Event('start')); } catch(e) {}
          }
          // Estimate duration and fire onend (rough: 100ms per character for normal rate)
          if (_fkEndTimer) clearTimeout(_fkEndTimer);
          var estimatedMs = Math.max(500, utterance.text.length * 100 / (utterance.rate || 1));
          var self = this;
          var utt = utterance;
          _fkEndTimer = setTimeout(function() {
            self.speaking = false;
            _fkSpeaking = false;
            if (utt.onend) {
              try { utt.onend(new Event('end')); } catch(e) {}
            }
          }, estimatedMs);
        },
        cancel: function() {
          this.speaking = false;
          _fkSpeaking = false;
          _fkPendingSpeak = null;
          if (_fkEndTimer) { clearTimeout(_fkEndTimer); _fkEndTimer = null; }
          window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'SPEECH_SYNTH_CANCEL' }));
        },
        pause: function() { this.paused = true; },
        resume: function() { this.paused = false; },
        getVoices: function() {
          // Trigger async load on first call (browsers typically call getVoices()
          // and then listen for voiceschanged event to get the real list)
          if (!_fkVoicesLoaded && _fkVoices.length === 0) {
            _fkLoadVoices();
          }
          return _fkVoices.slice();
        },
        addEventListener: function(type, fn) {
          if (type === 'voiceschanged') {
            if (_fkVoicesLoaded) {
              // Voices already loaded, fire immediately
              try { fn(new Event('voiceschanged')); } catch(e) {}
            } else {
              _fkVoicesChangedCbs.push(fn);
            }
          }
        },
        removeEventListener: function(type, fn) {
          if (type === 'voiceschanged') {
            _fkVoicesChangedCbs = _fkVoicesChangedCbs.filter(function(cb) { return cb !== fn; });
          }
        }
      };
      Object.defineProperty(synth, 'onvoiceschanged', {
        get: function() { return _fkVoicesChangedCbs[0] || null; },
        set: function(fn) {
          _fkVoicesChangedCbs = fn ? [fn] : [];
          if (fn && _fkVoicesLoaded) {
            try { fn(new Event('voiceschanged')); } catch(e) {}
          }
        }
      });
      Object.defineProperty(window, 'speechSynthesis', {
        get: function() { return synth; },
        configurable: true
      });
      // Start loading voices immediately
      _fkLoadVoices();
    })();

    // PDF link interception: prevent <a download href="...pdf"> from triggering
    // the native Android DownloadManager — instead force a real navigation so
    // onShouldStartLoadWithRequest can redirect to the local PDF viewer.
    if (${pdfViewerEnabled ? 'true' : 'false'}) {
      function interceptPdfLinks() {
        document.querySelectorAll('a[href]').forEach(function(a) {
          if (a.__pdfIntercepted) return;
          var href = (a.getAttribute('href') || '').toLowerCase().split('?')[0].split('#')[0];
          var hasDownload = a.hasAttribute('download');
          if (href.endsWith('.pdf') || hasDownload) {
            a.__pdfIntercepted = true;
            // Strip the download attribute so Android doesn't trigger the DownloadManager
            a.removeAttribute('download');
          }
        });
      }
      // Run immediately and watch for DOM changes (SPAs)
      interceptPdfLinks();
      var pdfObserver = new MutationObserver(interceptPdfLinks);
      pdfObserver.observe(document.body, { childList: true, subtree: true });
    }
  })();
  true;
  `;

    // Script d'injection pour forcer le clavier numérique
    const getKeyboardModeScript = (): string => {
      if (keyboardMode === 'default') {
        return '';
      }

      if (keyboardMode === 'force_numeric') {
        return `
        (function() {
          function forceNumericKeyboard() {
            const inputs = document.querySelectorAll('input');
            inputs.forEach(input => {
              // Ne pas modifier les types spéciaux
              const type = input.type.toLowerCase();
              if (type !== 'hidden' && type !== 'submit' && type !== 'button' && type !== 'checkbox' && type !== 'radio') {
                input.setAttribute('inputmode', 'numeric');
                input.setAttribute('pattern', '[0-9]*');
              }
            });
          }
          
          // Appliquer immédiatement
          forceNumericKeyboard();
          
          // Observer les changements du DOM
          const observer = new MutationObserver(forceNumericKeyboard);
          observer.observe(document.body, { childList: true, subtree: true });
        })();
      `;
      }

      if (keyboardMode === 'smart') {
        return `
        (function() {
          function smartDetectNumeric() {
            const inputs = document.querySelectorAll('input');
            inputs.forEach(input => {
              const type = input.type.toLowerCase();
              const name = (input.name || '').toLowerCase();
              const id = (input.id || '').toLowerCase();
              const placeholder = (input.placeholder || '').toLowerCase();
              const className = (input.className || '').toLowerCase();
              
              // Détecter les champs numériques
              const isNumericType = type === 'number' || type === 'tel';
              const hasNumericPattern = input.pattern && /[0-9]/.test(input.pattern);
              const hasNumericName = /price|quantity|qty|amount|number|num|phone|tel|code|zip|postal|card/.test(name + id + placeholder + className);
              
              if (isNumericType || hasNumericPattern || hasNumericName) {
                input.setAttribute('inputmode', 'numeric');
                input.setAttribute('pattern', '[0-9]*');
              }
            });
          }
          
          // Appliquer immédiatement
          smartDetectNumeric();
          
          // Observer les changements du DOM
          const observer = new MutationObserver(smartDetectNumeric);
          observer.observe(document.body, { childList: true, subtree: true });
        })();
      `;
      }

      return '';
    };

    const combinedInjectedJavaScript =
      injectedJavaScript + getKeyboardModeScript();

    // Gestion des messages venant de la webview
    const onMessageHandler = (event: any) => {
      const message = event.nativeEvent.data;

      // This bridge is a rendering hint only. Restrict it to the exact Relic
      // Commander origin and answer every valid protocol request, including
      // requests made after a navigation or reload.
      if (
        isRelicCommanderUrl(event.nativeEvent.url) &&
        isRcTerminalCapabilitiesRequest(message)
      ) {
        webViewRef.current?.injectJavaScript(
          RC_TERMINAL_CAPABILITIES_RESPONSE_SCRIPT,
        );
        return;
      }

      if (message === 'user-interaction' && onUserInteraction) {
        onUserInteraction();
      } else if (message.startsWith('{')) {
        // Parse JSON message
        try {
          const data = JSON.parse(message);
          if (data.type === 'FIVE_TAP_CLICK' && onUserInteraction) {
            onUserInteraction({ isTap: true, x: data.x, y: data.y });
          } else if (data.type === 'SPEECH_SYNTH_SPEAK') {
            // speechSynthesis polyfill: bridge to native Android TTS
            if (HttpServerModule?.speak) {
              HttpServerModule.speak(
                data.text || '',
                data.lang || '',
                data.voiceUri || '',
              ).catch((err: any) =>
                console.error('[WebView] TTS speak failed:', err),
              );
            }
          } else if (data.type === 'SPEECH_SYNTH_CANCEL') {
            // speechSynthesis polyfill: stop native TTS
            if (HttpServerModule?.stopSpeaking) {
              HttpServerModule.stopSpeaking().catch((err: any) =>
                console.error('[WebView] TTS cancel failed:', err),
              );
            }
          } else if (data.type === 'SPEECH_SYNTH_GET_VOICES') {
            // speechSynthesis polyfill: query available TTS voices from native
            if (HttpServerModule?.getTtsVoices) {
              HttpServerModule.getTtsVoices()
                .then((voices: any[]) => {
                  const voicesJson = JSON.stringify(voices || []);
                  // Use JSON.stringify on the already-stringified JSON to properly escape
                  // quotes and special chars for injection into a JS string literal
                  const safeArg = JSON.stringify(voicesJson);
                  webViewRef.current?.injectJavaScript(
                    `window.__fkSetVoices && window.__fkSetVoices(${safeArg}); true;`,
                  );
                })
                .catch((err: any) =>
                  console.error('[WebView] TTS getVoices failed:', err),
                );
            }
          } else if (data.type === 'PRINT_REQUEST') {
            // Handle print request from window.print()
            PrintModule.printWebView(
              data.title || 'FreeKiosk Print',
              data.paperSize || 'A4',
            )
              .then(() => console.log('[WebView] Print job started'))
              .catch((err: any) =>
                console.error('[WebView] Print failed:', err),
              );
          } else if (data.type === 'PDF_VIEWER_CLOSE') {
            // User closed PDF viewer, go back to previous page
            if (webViewRef.current) {
              webViewRef.current.goBack();
            }
          }
        } catch (e) {
          // Ignore parse errors
        }
      } else if (message === 'FIVE_TAP_CLICK' && onUserInteraction) {
        // Legacy: Dedicated tap event for 5-tap detection (no coordinates)
        onUserInteraction({ isTap: true });
      }
    };

    const handleError = (event: WebViewErrorEvent): void => {
      console.error('[FreeKiosk] WebView error:', event.nativeEvent);
      setError(true);
      setLoading(false);

      // Load about:blank to clear the native Android error page
      // This is the ONLY way to prevent the native WebView error page from covering our overlay
      webViewRef.current?.injectJavaScript(
        'window.location.href = "about:blank"; true;',
      );

      if (autoReload) {
        setTimeout(() => {
          setError(false);
          setLoading(true);
          setPageLoaded(false);
        }, 5000);
      }
    };

    const handleHttpError = (event: any): void => {
      const statusCode = event.nativeEvent.statusCode;
      const failedUrl = event.nativeEvent.url;
      console.error('[FreeKiosk] HTTP Error:', statusCode, failedUrl);

      // Only treat the error as fatal when it comes from the main document.
      // onReceivedHttpError also fires for sub-resources (images, scripts,
      // favicons…); a 404 on those must not hijack an otherwise-working page.
      if (
        failedUrl &&
        lastTopFrameUrlRef.current &&
        failedUrl !== lastTopFrameUrlRef.current
      ) {
        return;
      }

      // Show the customer-facing connection overlay for any main-page HTTP error.
      // The invisible admin hotspot remains available even when auto-reload is off.
      setError(true);
      setLoading(false);
      webViewRef.current?.injectJavaScript(
        'window.location.href = "about:blank"; true;',
      );

      // Auto-retry only when the feature is enabled.
      if (autoReload) {
        setTimeout(() => {
          setError(false);
          setLoading(true);
          setPageLoaded(false);
        }, 5000);
      }
    };

    // #198 — The Chromium renderer process died (typically an OOM kill). The native
    // RNCWebViewClient already returns true so the app process survives, but the WebView
    // instance is now defunct (blank white screen) and, per Android's contract, must be
    // remounted rather than reused. Best-effort clear the WebView cache to rebuild the
    // corrupted Chromium code-cache index, then ask the parent to bump webViewKey for a
    // full remount (same recovery pattern as inactivity return / planner).
    const handleRenderProcessGone = (
      event: WebViewRenderProcessGoneEvent,
    ): void => {
      const didCrash = !!event?.nativeEvent?.didCrash;
      console.error(
        '[FreeKiosk] WebView renderer process gone (didCrash=' +
          didCrash +
          '), recovering...',
      );
      try {
        webViewRef.current?.clearCache(true);
      } catch {
        // Defunct WebView — clearing may throw; the remount below is the real recovery.
      }
      if (onRenderProcessGone) {
        onRenderProcessGone(didCrash);
      }
    };

    const handleReload = (): void => {
      setError(false);
      setLoading(true);
      setPageLoaded(false);
    };

    if (!url) {
      return (
        <View style={styles.welcomeContainer}>
          <Image
            accessibilityLabel="Relic Commander Terminal"
            source={require('../../img/rc-terminal.png')}
            resizeMode="contain"
            style={styles.welcomeLogo}
          />

          {/* Preserve the configured secret admin gesture without advertising it. */}
          <TouchableOpacity
            testID="welcome-admin-hotspot"
            style={styles.adminHotspot}
            activeOpacity={1}
            accessible={false}
            importantForAccessibility="no-hide-descendants"
            onPress={() => {
              if (onUserInteraction) {
                onUserInteraction({
                  isTap: true,
                  x: 0,
                  y: 0,
                  fromAdminHotspot: true,
                });
              }
            }}
          />
        </View>
      );
    }

    return (
      <View style={styles.container} ref={containerViewRef}>
        <WebView
          ref={webViewRef}
          source={{ uri: error ? 'about:blank' : url }}
          style={styles.webview}
          // Keep browser identity consistent for security challenges such as
          // Cloudflare Turnstile. Only override Android WebView's native UA when
          // the administrator explicitly configured one.
          userAgent={customUserAgent?.trim() || undefined}
          // Keep every scheme inside the WebView decision path. Otherwise the
          // library delegates non-whitelisted schemes to Android Linking, which
          // could open another application outside the kiosk.
          originWhitelist={['*']}
          mixedContentMode="always"
          onHttpError={handleHttpError}
          basicAuthCredential={basicAuthCredential}
          onLoadStart={() => {
            // Don't reset error state when loading about:blank (error recovery)
            if (!error) {
              setLoading(true);
              setPageLoaded(false);
            }

            // Fire OS/Fire Tablet workaround: Force hide loading spinner after 10s
            // This handles cases where onLoadEnd doesn't fire on SPAs or redirects.
            // Only start the timer once — don't reset it on intermediate redirect/frame
            // events, otherwise a redirect chain can keep resetting the countdown forever.
            if (!error && !loadingTimeoutRef.current) {
              loadingTimeoutRef.current = setTimeout(() => {
                setLoading(false);
                loadingTimeoutRef.current = null;
              }, 10000);
            }
          }}
          onLoadEnd={() => {
            // Don't mark as loaded when loading about:blank during error state
            if (!error) {
              setLoading(false);
              setPageLoaded(true);
            }

            // Clear timeout since load completed normally
            if (loadingTimeoutRef.current) {
              clearTimeout(loadingTimeoutRef.current);
              loadingTimeoutRef.current = null;
            }
          }}
          onLoadProgress={({ nativeEvent }) => {
            // For SPAs like Nuxt/Home Assistant, hide spinner when fully loaded
            if (nativeEvent.progress === 1 && !error) {
              setLoading(false);
              setPageLoaded(true);

              // Clear timeout since we've reached 100%
              if (loadingTimeoutRef.current) {
                clearTimeout(loadingTimeoutRef.current);
                loadingTimeoutRef.current = null;
              }
            }
          }}
          onError={handleError}
          onRenderProcessGone={handleRenderProcessGone}
          javaScriptEnabled={true}
          domStorageEnabled={true}
          injectedJavaScript={combinedInjectedJavaScript}
          onMessage={onMessageHandler}
          startInLoadingState={true}
          onShouldStartLoadWithRequest={(request: ShouldStartLoadRequest) => {
            // Security: Block dangerous URL schemes
            const urlLower = request.url.toLowerCase();

            // Turnstile and other standards-compliant embedded challenges use
            // these internal documents while constructing their sandboxed iframe.
            if (
              urlLower.startsWith('about:blank') ||
              urlLower.startsWith('about:srcdoc')
            ) {
              return true;
            }

            // Allow Cloudflare Turnstile inside a subframe even when the kiosk URL
            // whitelist is enabled. Never grant this exception to top-frame
            // navigation, so it cannot become an escape route from Relic Commander.
            if (
              request.isTopFrame === false &&
              /^https:\/\/challenges\.cloudflare\.com(?:[/:?#]|$)/i.test(
                request.url,
              )
            ) {
              return true;
            }

            // Relic Commander terminal confinement: external resources and
            // Turnstile subframes remain unaffected, but the main document can
            // never become an off-domain browsing surface.
            if (shouldReturnToRcHome(url, request.url, request.isTopFrame)) {
              console.warn(
                '[RC Terminal] Blocked off-domain top-frame navigation:',
                request.url,
              );
              returnToRelicCommanderHome();
              return false;
            }

            // Allow file:// only for our bundled PDF viewer
            if (urlLower.startsWith('file:///android_asset/pdfjs/')) {
              return true;
            }

            if (
              urlLower.startsWith('file://') ||
              urlLower.startsWith('javascript:')
            ) {
              console.warn(
                '[FreeKiosk] Blocked dangerous URL scheme:',
                request.url,
              );
              return false;
            }

            // data: URLs - allow when printing is enabled (some label/receipt sites
            // generate print content as data:text/html popups)
            if (urlLower.startsWith('data:')) {
              if (printEnabled) {
                console.log(
                  '[FreeKiosk] Allowing data: URL (printing enabled)',
                );
                return true;
              }
              console.warn(
                '[FreeKiosk] Blocked data: URL (printing disabled):',
                request.url.substring(0, 100),
              );
              return false;
            }

            // PDF Viewer: intercept PDF links and redirect to local viewer
            if (pdfViewerEnabled && request.isTopFrame) {
              // Check direct PDF URLs (path ends with .pdf)
              const urlPath = urlLower.split('?')[0].split('#')[0];
              let pdfUrl: string | null = null;

              if (urlPath.endsWith('.pdf')) {
                pdfUrl = request.url;
              }

              // Check Google redirect URLs: google.com/url?...url=<pdf_url>...
              if (
                !pdfUrl &&
                (urlLower.includes('google.com/url?') ||
                  urlLower.includes('google.com/url&'))
              ) {
                try {
                  const queryStart = request.url.indexOf('?');
                  if (queryStart !== -1) {
                    const queryStr = request.url.substring(queryStart + 1);
                    const params = queryStr.split('&');
                    for (const param of params) {
                      const [key, ...valueParts] = param.split('=');
                      if (key === 'url' || key === 'q') {
                        const targetUrl = decodeURIComponent(
                          valueParts.join('='),
                        );
                        const targetPath = targetUrl
                          .toLowerCase()
                          .split('?')[0]
                          .split('#')[0];
                        if (targetPath.endsWith('.pdf')) {
                          pdfUrl = targetUrl;
                          break;
                        }
                      }
                    }
                  }
                } catch (e) {
                  // Invalid URL, ignore
                }
              }

              if (pdfUrl) {
                console.log(
                  '[FreeKiosk] PDF detected, opening in viewer:',
                  pdfUrl,
                );
                const viewerUrl = `file:///android_asset/pdfjs/viewer.html?file=${encodeURIComponent(
                  pdfUrl,
                )}`;
                if (webViewRef.current) {
                  webViewRef.current.injectJavaScript(
                    `window.location.href = ${JSON.stringify(
                      viewerUrl,
                    )}; true;`,
                  );
                }
                return false;
              }
            }

            // URL Filtering (blacklist/whitelist)
            if (isUrlBlocked(request.url)) {
              showBlockedFeedback(request.url);
              return false;
            }

            // Remember the main-document navigation target so HTTP errors can be
            // attributed to the main frame vs. a sub-resource (see handleHttpError).
            if (request.isTopFrame) {
              lastTopFrameUrlRef.current = request.url;
            }

            return true;
          }}
          onNavigationStateChange={navState => {
            // Track web navigation state (for back button and dashboard nav)
            if (onNavigationStateChange) {
              onNavigationStateChange({
                canGoBack: navState.canGoBack,
                canGoForward: navState.canGoForward,
                title: navState.title || '',
              });
            }

            // Some SPA/router transitions do not pass through the native load
            // request callback. Detect them here and replace their history entry
            // with the safe terminal home instead of relying on Back navigation.
            if (shouldReturnToRcHome(url, navState.url, true)) {
              returnToRelicCommanderHome();
              return;
            }
            // Report URL changes for inactivity return feature
            if (onPageNavigated && navState.url) {
              onPageNavigated(navState.url);
            }
            // URL Filtering: catch SPA/client-side navigations (pushState, router.push)
            // that don't trigger onShouldStartLoadWithRequest
            if (
              navState.url &&
              !isGoingBackRef.current &&
              isUrlBlocked(navState.url)
            ) {
              showBlockedFeedback(navState.url);
              // Navigate back to cancel the SPA navigation
              isGoingBackRef.current = true;
              if (webViewRef.current) {
                webViewRef.current.goBack();
              }
              // Reset guard after a short delay
              setTimeout(() => {
                isGoingBackRef.current = false;
              }, 500);
            }
          }}
          cacheEnabled={true}
          incognito={false}
          sharedCookiesEnabled={true}
          thirdPartyCookiesEnabled={true}
          // Storage settings for Pinia/Nuxt compatibility
          cacheMode="LOAD_DEFAULT"
          // Keep a single native WebView. Android otherwise allocates a secondary
          // WebView for target="_blank"/window.open(), even when no tab is shown.
          // With multiple windows disabled, those links stay in this WebView and
          // pass through the same RC origin lock and URL filtering as normal links.
          setSupportMultipleWindows={false}
          // Security: File access disabled by default.
          // When PDF viewer is enabled, allow file access for loading bundled PDF.js from assets
          // and allow universal access so PDF.js can fetch remote PDF files.
          allowFileAccess={pdfViewerEnabled}
          allowUniversalAccessFromFileURLs={pdfViewerEnabled}
          allowFileAccessFromFileURLs={pdfViewerEnabled}
          nestedScrollEnabled={true}
          // Only control user gestures. Relic Commander remains solely responsible
          // for viewport, responsive density and page scale.
          setBuiltInZoomControls={!disableUserZoom}
          setDisplayZoomControls={false}
          mediaPlaybackRequiresUserAction={false}
          allowsInlineMediaPlayback={true}
          // RC Terminal has no camera/microphone use case. Deny capture explicitly;
          // normal audio/video playback and Android keyboard input remain available.
          mediaCapturePermissionGrantType="deny"
        />

        {loading && !error && (
          <View style={styles.loadingContainer}>
            <View style={styles.loadingCard}>
              <Text style={styles.loadingEyebrow}>
                RELIC COMMANDER TERMINAL
              </Text>
              <ActivityIndicator
                size="large"
                color={RC_THEME.colors.accentBright}
              />
              <Text style={styles.loadingText}>
                Contacting Relic Commander Network
              </Text>
            </View>
            {/* Invisible admin-only hotspot: preserves secret PIN access without advertising it. */}
            <TouchableOpacity
              testID="loading-admin-hotspot"
              style={styles.adminHotspot}
              activeOpacity={1}
              accessible={false}
              importantForAccessibility="no-hide-descendants"
              onPress={() => {
                if (onUserInteraction) {
                  onUserInteraction({
                    isTap: true,
                    x: 0,
                    y: 0,
                    fromAdminHotspot: true,
                  });
                }
              }}
            />
          </View>
        )}

        {error && (
          <View style={styles.errorContainer}>
            <View
              style={[
                styles.errorCard,
                isLandscape && styles.errorCardLandscape,
              ]}
            >
              <Image
                accessibilityLabel="Relic Commander Terminal"
                source={require('../../img/rc-terminal.png')}
                resizeMode="contain"
                style={[
                  styles.errorTerminalLogo,
                  isLandscape && styles.errorTerminalLogoLandscape,
                ]}
              />
              <View style={styles.errorContent}>
                <Text style={styles.errorEyebrow}>
                  RELIC COMMANDER TERMINAL
                </Text>
                <Text style={styles.errorText}>Connection unavailable</Text>
                <Text style={styles.errorLead}>
                  Relic Commander could not be reached.
                </Text>

                <View style={styles.wifiHelpCard}>
                  <MaterialCommunityIcons
                    name="wifi-cog"
                    size={24}
                    color={RC_THEME.colors.accentBright}
                  />
                  <Text style={styles.wifiHelpText}>
                    Connect this tablet to Wi-Fi, then try reaching Relic
                    Commander again.
                  </Text>
                </View>

                <Text style={styles.errorSubtext}>
                  If Wi-Fi is already connected, Relic Commander may be
                  temporarily unavailable.
                </Text>

                {autoReload && (
                  <View style={styles.autoRetryRow}>
                    <MaterialCommunityIcons
                      name="sync"
                      size={16}
                      color={RC_THEME.colors.textMuted}
                    />
                    <Text style={styles.helpText}>
                      We will keep trying automatically.
                    </Text>
                  </View>
                )}

                <View
                  style={[
                    styles.errorActions,
                    isLandscape && styles.errorActionsLandscape,
                  ]}
                >
                  <TouchableOpacity
                    style={[
                      styles.reloadButton,
                      isLandscape && styles.errorActionLandscape,
                    ]}
                    onPress={handleReload}
                  >
                    <MaterialCommunityIcons
                      name="refresh"
                      size={19}
                      color={RC_THEME.colors.textInverse}
                    />
                    <Text style={styles.reloadText}>Try again now</Text>
                  </TouchableOpacity>

                  {onOpenWifiSettings && (
                    <TouchableOpacity
                      accessibilityRole="button"
                      accessibilityLabel="Open Wi-Fi settings"
                      style={[
                        styles.wifiSettingsButton,
                        isLandscape && styles.errorActionLandscape,
                      ]}
                      onPress={onOpenWifiSettings}
                    >
                      <MaterialCommunityIcons
                        name="wifi-cog"
                        size={19}
                        color={RC_THEME.colors.accentBright}
                      />
                      <Text style={styles.wifiSettingsText}>
                        Wi-Fi settings
                      </Text>
                    </TouchableOpacity>
                  )}
                </View>
              </View>
            </View>

            {/* Invisible admin-only hotspot: five taps still open the protected PIN screen. */}
            <TouchableOpacity
              testID="error-admin-hotspot"
              style={styles.adminHotspot}
              activeOpacity={1}
              accessible={false}
              importantForAccessibility="no-hide-descendants"
              onPress={() => {
                if (onUserInteraction) {
                  onUserInteraction({
                    isTap: true,
                    x: 0,
                    y: 0,
                    fromAdminHotspot: true,
                  });
                }
              }}
            />
          </View>
        )}

        {blockedUrlMessage && (
          <View style={styles.blockedToast}>
            <Text style={styles.blockedToastText}>{blockedUrlMessage}</Text>
          </View>
        )}
      </View>
    );
  },
);

const styles = StyleSheet.create({
  // WELCOME SCREEN STYLES
  welcomeContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: RC_THEME.colors.background,
    padding: 24,
  },
  welcomeLogo: {
    width: '92%',
    height: '92%',
    maxWidth: 720,
    maxHeight: 720,
  },

  // WEBVIEW STYLES
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  webview: {
    flex: 1,
  },
  loadingContainer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: RC_THEME.colors.background,
    padding: 24,
  },
  loadingCard: {
    minWidth: 280,
    alignItems: 'center',
    paddingHorizontal: 28,
    paddingVertical: 30,
    borderWidth: 1,
    borderColor: RC_THEME.colors.borderStrong,
    borderRadius: RC_THEME.radius.large,
    backgroundColor: RC_THEME.colors.surfaceCard,
    ...RC_THEME.shadow.card,
  },
  loadingEyebrow: {
    marginBottom: 20,
    color: RC_THEME.colors.primary,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 2,
  },
  loadingText: {
    marginTop: 18,
    color: RC_THEME.colors.textSecondary,
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  errorContainer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: RC_THEME.colors.background,
    padding: 24,
  },
  errorCard: {
    width: '100%',
    maxWidth: 520,
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingVertical: 26,
    borderWidth: 1,
    borderColor: RC_THEME.colors.borderStrong,
    borderRadius: RC_THEME.radius.large,
    backgroundColor: RC_THEME.colors.surfaceCard,
    ...RC_THEME.shadow.card,
  },
  errorCardLandscape: {
    maxWidth: 900,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 28,
    paddingHorizontal: 30,
    paddingVertical: 22,
  },
  errorTerminalLogo: {
    width: '100%',
    maxWidth: 272,
    aspectRatio: 1,
    alignSelf: 'center',
    marginBottom: 14,
  },
  errorTerminalLogoLandscape: {
    width: 260,
    height: 260,
    marginBottom: 0,
  },
  errorContent: {
    flex: 1,
    width: '100%',
    alignItems: 'center',
  },
  errorEyebrow: {
    marginBottom: 5,
    color: RC_THEME.colors.primary,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 2,
  },
  errorText: {
    color: RC_THEME.colors.textPrimary,
    fontSize: 20,
    fontWeight: '700',
    letterSpacing: 1,
    textAlign: 'center',
    textTransform: 'uppercase',
  },
  errorLead: {
    marginTop: 10,
    color: RC_THEME.colors.textSecondary,
    fontSize: 15,
    lineHeight: 21,
    textAlign: 'center',
  },
  wifiHelpCard: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginTop: 18,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderWidth: 1,
    borderColor: RC_THEME.colors.primary,
    borderRadius: RC_THEME.radius.medium,
    backgroundColor: RC_THEME.colors.surfaceAccent,
  },
  wifiHelpText: {
    flex: 1,
    color: RC_THEME.colors.textSection,
    fontSize: 14,
    fontWeight: '600',
    lineHeight: 20,
  },
  errorSubtext: {
    marginTop: 16,
    color: RC_THEME.colors.textMuted,
    fontSize: 13,
    lineHeight: 19,
    textAlign: 'center',
  },
  autoRetryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 12,
  },
  errorActions: {
    width: '100%',
    alignItems: 'center',
  },
  errorActionsLandscape: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 12,
  },
  errorActionLandscape: {
    flex: 1,
    minWidth: 0,
    marginTop: 20,
  },
  helpText: {
    color: RC_THEME.colors.textMuted,
    fontSize: 12,
    textAlign: 'center',
  },
  reloadButton: {
    minWidth: 210,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 9,
    marginTop: 20,
    paddingHorizontal: 24,
    paddingVertical: 14,
    borderWidth: 1,
    borderColor: RC_THEME.colors.primary,
    borderRadius: RC_THEME.radius.small,
    backgroundColor: RC_THEME.colors.primaryPressed,
    ...RC_THEME.shadow.glow,
  },
  reloadText: {
    color: RC_THEME.colors.textInverse,
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  wifiSettingsButton: {
    minWidth: 210,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 9,
    marginTop: 10,
    paddingHorizontal: 24,
    paddingVertical: 13,
    borderWidth: 1,
    borderColor: RC_THEME.colors.borderStrong,
    borderRadius: RC_THEME.radius.small,
    backgroundColor: RC_THEME.colors.surfaceAccent,
  },
  wifiSettingsText: {
    color: RC_THEME.colors.accentBright,
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  blockedToast: {
    position: 'absolute',
    bottom: 40,
    alignSelf: 'center',
    backgroundColor: 'rgba(0,0,0,0.8)',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 20,
  },
  blockedToastText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  adminHotspot: {
    position: 'absolute',
    bottom: 20,
    right: 20,
    width: 48,
    height: 48,
    zIndex: 9999,
  },
});

WebViewComponent.displayName = 'WebViewComponent';

export default WebViewComponent;
