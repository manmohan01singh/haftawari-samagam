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
  const embedUrl = `https://www.youtube.com/embed/${encodeURIComponent(youtubeVideoId)}?rel=0&playsinline=1`;
  return (
    <View style={styles.wrap}>
      <WebView
        source={{ uri: embedUrl }}
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
