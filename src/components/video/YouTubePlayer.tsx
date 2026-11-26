import React from 'react';
import { StyleSheet, View } from 'react-native';
import { WebView } from 'react-native-webview';
import { layout, lightColors } from '../../theme';

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
 */
export function YouTubePlayer({ youtubeVideoId }: YouTubePlayerProps) {
  const embedUrl = `https://www.youtube.com/embed/${encodeURIComponent(youtubeVideoId)}?rel=0&playsinline=1`;
  return (
    <View style={styles.wrap}>
      <WebView
        source={{ uri: embedUrl }}
        style={styles.webview}
        allowsFullscreenVideo
        allowsInlineMediaPlayback
        mediaPlaybackRequiresUserAction={false}
        javaScriptEnabled
        domStorageEnabled
        originWhitelist={['https://www.youtube.com', 'https://www.youtube-nocookie.com']}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    width: '100%',
    aspectRatio: layout.thumbnailAspectRatio,
    backgroundColor: lightColors.playerBackground,
  },
  webview: { flex: 1, backgroundColor: lightColors.playerBackground },
});
