import React, {
  forwardRef,
  memo,
  useCallback,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import { layout, useTheme, type ThemeColors } from '../../../theme';

/** Minimal structural handle for the WebView (only what sync needs). */
interface WebViewHandle {
  injectJavaScript: (js: string) => void;
}

export interface YouTubeEmbedHandle {
  /** Seek the official player to an absolute position (seconds). */
  seekTo: (seconds: number) => void;
  play: () => void;
  pause: () => void;
}

interface YouTubeEmbedProps {
  youtubeVideoId: string;
  /** Position (seconds) the player starts at — the session offset. */
  startSeconds: number;
  autoplay?: boolean;
  /** Player-reported position, ~every 3s while the player exists. */
  onTimeUpdate?: (seconds: number) => void;
  onReady?: () => void;
}

/**
 * Official YouTube embedded player (IFrame API inside a WebView).
 *
 * The embed is loaded with its DEFAULT controls and branding — nothing
 * is hidden, covered or re-skinned, per YouTube's terms and the project
 * rules. Synchronization is achieved only through the documented
 * IFrame API: the `start` player variable for late joiners, and
 * `seekTo()` for drift correction / re-sync.
 *
 * Picture-in-Picture (Route 1, see docs/PIP.md):
 * `allowsPictureInPictureMediaPlayback` enables the WebView's own PiP
 * capability — real on iOS (WKWebViewConfiguration flag); on Android
 * the prop is a no-op in react-native-webview and PiP is an Activity
 * capability enabled by plugins/withPictureInPicture.js instead.
 * Actual PiP entry is decided by the OS and YouTube's player; this
 * app adds no PiP button, and playback outside PiP still pauses when
 * the app is left, per YouTube policy.
 */
export const YouTubeEmbed = memo(
  forwardRef<YouTubeEmbedHandle, YouTubeEmbedProps>(
  function YouTubeEmbed(
    { youtubeVideoId, startSeconds, autoplay = false, onTimeUpdate, onReady },
    ref,
  ) {
    const { colors } = useTheme();
    const styles = useMemo(() => createStyles(colors), [colors]);
    // Freeze the start offset at mount (UX perf pass): the caller
    // passes a LIVE session offset that changes on every clock tick,
    // and the WebView source html is built from it — without freezing,
    // the source changed every tick and the WebView reloaded. The
    // parent remounts this component (key = video + playing/replay)
    // when a new start is needed; drift is corrected via seekTo.
    const [initialStartSeconds] = useState(() =>
      Math.max(0, Math.floor(startSeconds)),
    );
    // Loading facade (same as the web embed): real thumbnail +
    // spinner until the player posts 'ready'; pointer-events-none
    // and removed on ready — never over the playing embed.
    const [readyVideoId, setReadyVideoId] = useState<string | null>(null);
    const webViewRef = useRef<WebViewHandle | null>(null);
    const setWebViewRef = (instance: WebViewHandle | null): void => {
      webViewRef.current = instance;
    };

    const run = useCallback((js: string) => {
      webViewRef.current?.injectJavaScript(`${js}; true;`);
    }, []);

    useImperativeHandle(ref, () => ({
      seekTo: (seconds: number) =>
        run(`window.__sessionPlayer && window.__sessionPlayer.seekTo(${Math.max(0, Math.floor(seconds))}, true)`),
      play: () => run('window.__sessionPlayer && window.__sessionPlayer.playVideo()'),
      pause: () => run('window.__sessionPlayer && window.__sessionPlayer.pauseVideo()'),
    }));

    const html = buildEmbedHtml(youtubeVideoId, initialStartSeconds, autoplay);

    const onMessage = (event: WebViewMessageEvent): void => {
      const msg = event.nativeEvent.data;
      if (msg === 'ready') {
        setReadyVideoId(youtubeVideoId);
        onReady?.();
      } else if (msg.startsWith('time:')) {
        const seconds = Number.parseFloat(msg.slice(5));
        if (Number.isFinite(seconds)) onTimeUpdate?.(seconds);
      }
    };

    return (
      <View style={styles.wrap}>
        <WebView
          ref={setWebViewRef}
          source={{ html, baseUrl: 'https://com.haftawarisamagam.app' }}
          originWhitelist={['*']}
          javaScriptEnabled
          domStorageEnabled
          allowsFullscreenVideo
          allowsPictureInPictureMediaPlayback
          mediaPlaybackRequiresUserAction={false}
          onMessage={onMessage}
          style={styles.webview}
        />
        {readyVideoId !== youtubeVideoId ? (
          <View style={styles.facade} pointerEvents="none">
            <Image
              source={{ uri: `https://i.ytimg.com/vi/${encodeURIComponent(youtubeVideoId)}/hqdefault.jpg` }}
              style={styles.poster}
              contentFit="cover"
              cachePolicy="memory-disk"
            />
            <View style={styles.spinnerWrap}>
              <ActivityIndicator color="#FFFFFF" />
            </View>
          </View>
        ) : null}
      </View>
    );
  }),
);

function buildEmbedHtml(videoId: string, startSeconds: number, autoplay: boolean): string {
  const config = JSON.stringify({
    videoId,
    start: startSeconds,
    autoplay: autoplay ? 1 : 0,
  });
  return [
    '<!DOCTYPE html><html><head>',
    '<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />',
    '<style>html,body{margin:0;padding:0;background:#000;height:100%;overflow:hidden}',
    '#player{position:absolute;top:0;left:0;width:100%;height:100%}</style>',
    '<script src="https://www.youtube.com/iframe_api"></script>',
    '</head><body><div id="player"></div><script>',
    'var CFG = ' + config + ';',
    'function post(m){ if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(m); }',
    'function onYouTubeIframeAPIReady(){',
    '  window.__sessionPlayer = new YT.Player("player", {',
    '    videoId: CFG.videoId,',
    '    playerVars: { start: CFG.start, autoplay: CFG.autoplay, rel: 0, playsinline: 1, origin: "https://com.haftawarisamagam.app", widget_referrer: "https://com.haftawarisamagam.app" },',
    '    events: { onReady: function(){ post("ready"); },',
    '              onStateChange: function(e){ post("state:" + e.data); } }',
    '  });',
    '  setInterval(function(){',
    '    var p = window.__sessionPlayer;',
    '    if (p && p.getCurrentTime) { try { post("time:" + p.getCurrentTime()); } catch (e) {} }',
    '  }, 3000);',
    '}',
    '</script></body></html>',
  ].join('\n');
}

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  wrap: {
    width: '100%',
    aspectRatio: layout.thumbnailAspectRatio,
    backgroundColor: colors.playerBackground,
  },
  webview: { flex: 1, backgroundColor: colors.playerBackground },
  facade: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  poster: { width: '100%', height: '100%' },
  spinnerWrap: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
