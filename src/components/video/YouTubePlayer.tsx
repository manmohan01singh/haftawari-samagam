import React, { forwardRef, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import { WebView } from 'react-native-webview';
import { layout, useTheme, type ThemeColors } from '../../theme';

export interface YouTubePlayerHandle {
  play: () => void;
  pause: () => void;
  seekTo: (seconds: number) => void;
}

interface YouTubePlayerProps {
  youtubeVideoId: string;
  /** The WebView finished its first load. */
  onReady?: () => void;
  /**
   * Not reported on native: this WebView bridge carries commands
   * in (below) but no state channel back, so the mini bar's icon
   * follows the last command the bar itself sent. The web player
   * reports the embed's true state via the IFrame API.
   */
  onPlayingChange?: (playing: boolean) => void;
  /** Fill the parent completely instead of holding a 16:9 box (Shorts). */
  fill?: boolean;
  /** Loop the video when it ends (Shorts behaviour). */
  loop?: boolean;
  /** Start playback as soon as the embed loads (Watch page). */
  autoplay?: boolean;
}

/**
 * Official YouTube embedded player (native): an iframe embed of
 * youtube.com/embed/<id> inside a WebView. The embed is YouTube's own
 * player — its branding, ads and controls are served by YouTube and
 * are never hidden, overlaid or modified.
 *
 * Phase E: the persistent mini player's bar drives the embed
 * through the documented IFrame API — commands are posted into the
 * iframe from the WebView (the embed URL already carries
 * enablejsapi=1). The visible player is unchanged.
 *
 * Picture-in-Picture (Route 1, see docs/PIP.md):
 * `allowsPictureInPictureMediaPlayback` enables the platform PiP
 * capability of the WebView itself. On iOS this is real: it sets
 * WKWebViewConfiguration.allowsPictureInPictureMediaPlayback, so a
 * playing video may move into the system PiP window. On Android the
 * prop is a no-op inside react-native-webview — Android PiP is an
 * Activity capability, enabled by the local config plugin
 * (plugins/withPictureInPicture.js). Whether the YouTube embed
 * actually enters PiP is decided by the OS and YouTube's player,
 * never by a custom button in this app, and background playback
 * outside PiP still pauses per YouTube policy.
 */
export const YouTubePlayer = forwardRef<YouTubePlayerHandle, YouTubePlayerProps>(
  function YouTubePlayer({ youtubeVideoId, onReady, fill, loop, autoplay }, ref) {
    const { colors } = useTheme();
    const styles = useMemo(() => createStyles(colors), [colors]);
    // Same loading facade as the web player (QA issues 5/6): the real
    // thumbnail + spinner until the WebView finishes its first load,
    // removed immediately afterwards — never over the playing embed.
    const [loaded, setLoaded] = useState(false);
    // Structural handle (same pattern as the session embed): the
    // react-native-webview class type does not survive this
    // project's React 19 JSX typing, but the one method we need is
    // stable.
    const webViewRef = useRef<{ injectJavaScript: (js: string) => void } | null>(null);
    const setWebViewRef = (instance: { injectJavaScript: (js: string) => void } | null): void => {
      webViewRef.current = instance;
    };
    const onReadyRef = useRef(onReady);
    onReadyRef.current = onReady;

    useImperativeHandle(ref, () => ({
      play: () => postCommand('playVideo'),
      pause: () => postCommand('pauseVideo'),
      seekTo: (seconds: number) =>
        postCommand('seekTo', [Math.max(0, Math.floor(seconds)), true]),
    }));

    function postCommand(func: string, args: unknown[] = []) {
      const payload = JSON.stringify({ event: 'command', func, args });
      webViewRef.current?.injectJavaScript(
        `(function(){var f=document.querySelector('iframe');if(f&&f.contentWindow){f.contentWindow.postMessage(${JSON.stringify(payload)},'*');}})();true;`,
      );
    }

    // Error 153 fix (first-APK device report, 27 Nov 2026; form
    // corrected the same day per YouTube's Required Minimum
    // Functionality + IFrame API reference, deep-research verified):
    // loading the bare embed URL as the WebView's top-level document
    // gives the player an opaque origin and NO Referer, and error 153
    // is defined as exactly that — "the request does not include the
    // HTTP Referer header". For a locally loaded HTML page the
    // documented remedy is baseUrl (Android loadDataWithBaseURL),
    // which sets the Referer — and the Referer must identify THIS app
    // as `https://<app package id>`, never youtube.com (claiming
    // youtube.com misidentifies the API client; it is the documented
    // cause of error 152 in other players). `origin` and
    // `widget_referrer` carry the same app identity for the JS-API
    // channel. The player itself remains YouTube's own, untouched.
    const APP_ORIGIN = 'https://com.haftawarisamagam.app';
    const embedUrl = `https://www.youtube.com/embed/${encodeURIComponent(youtubeVideoId)}?rel=0&playsinline=1&enablejsapi=1&origin=${APP_ORIGIN}&widget_referrer=${APP_ORIGIN}` + (loop ? `&loop=1&playlist=${encodeURIComponent(youtubeVideoId)}` : '') + (autoplay ? '&autoplay=1' : '');
    const embedHtml = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no"><style>html,body{margin:0;padding:0;background:#000;height:100%;overflow:hidden}iframe{position:absolute;top:0;left:0;width:100%;height:100%;border:0}</style></head><body><iframe src="${embedUrl}" allow="accelerometer; autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe></body></html>`;
    return (
      <View style={fill ? styles.wrapFill : styles.wrap}>
        <WebView
          ref={setWebViewRef}
          source={{ html: embedHtml, baseUrl: APP_ORIGIN }}
          onLoadEnd={() => {
            setLoaded(true);
            onReadyRef.current?.();
          }}
          style={styles.webview}
          allowsFullscreenVideo
          allowsInlineMediaPlayback
          allowsPictureInPictureMediaPlayback
          mediaPlaybackRequiresUserAction={false}
          javaScriptEnabled
          domStorageEnabled
          originWhitelist={['https://www.youtube.com', 'https://www.youtube-nocookie.com']}
        />
        {!loaded ? (
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
  },
);

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  wrap: {
    width: '100%',
    aspectRatio: layout.thumbnailAspectRatio,
    backgroundColor: colors.playerBackground,
  },
  wrapFill: { flex: 1, width: '100%', height: '100%', backgroundColor: colors.playerBackground },
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
