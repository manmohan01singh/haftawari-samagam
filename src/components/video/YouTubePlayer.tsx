import React, { useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import { WebView } from 'react-native-webview';
import { layout, useTheme, type ThemeColors } from '../../theme';

interface YouTubePlayerProps {
  youtubeVideoId: string;
}

/**
 * Official YouTube embedded player (native): an iframe embed of
 * youtube.com/embed/<id> inside a WebView. The embed is YouTube's own
 * player — its branding, ads and controls are served by YouTube and are
 * never hidden, overlaid or modified. Playback position is not read
 * back (the embed does not expose it to the host), which is why watch
 * history stores position 0.
 *
 * Mounted ONLY by the watch screen, and only after its parent defers
 * mounting until the navigation transition has settled (lazy load).
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
export function YouTubePlayer({ youtubeVideoId }: YouTubePlayerProps) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  // Same loading facade as the web player (QA issues 5/6): the real
  // thumbnail + spinner until the WebView finishes its first load,
  // removed immediately afterwards — never over the playing embed.
  const [loaded, setLoaded] = useState(false);
  // Error 153 fix (first-APK device report, 27 Nov 2026): loading the
  // bare embed URL as the WebView's top-level document gives the
  // player an opaque origin and no Referer, and YouTube now refuses
  // with "Video player configuration error" (error 153). The embed
  // must live in a real page served from a youtube.com origin: an
  // inline document with baseUrl https://www.youtube.com plus the
  // matching `origin` embed parameter is the documented, permanent
  // shape — the player itself remains YouTube's own, untouched.
  const embedUrl = `https://www.youtube.com/embed/${encodeURIComponent(youtubeVideoId)}?rel=0&playsinline=1&origin=https://www.youtube.com`;
  const embedHtml = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no"><style>html,body{margin:0;padding:0;background:#000;height:100%;overflow:hidden}iframe{position:absolute;top:0;left:0;width:100%;height:100%;border:0}</style></head><body><iframe src="${embedUrl}" allow="accelerometer; autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe></body></html>`;
  return (
    <View style={styles.wrap}>
      <WebView
        source={{ html: embedHtml, baseUrl: 'https://www.youtube.com' }}
        onLoadEnd={() => setLoaded(true)}
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
