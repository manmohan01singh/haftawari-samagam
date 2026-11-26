import React, { useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import { layout, lightColors } from '../../theme';

interface YouTubePlayerProps {
  youtubeVideoId: string;
}

/**
 * Official YouTube embedded player (web / PWA): a plain iframe embed.
 * Same rule as native — YouTube's own player, branding, ads and
 * controls, untouched. (Metro resolves this .web variant on web.)
 *
 * Loading facade (QA issues 5/6): until the iframe reports its first
 * load, the black player area shows the video's REAL YouTube
 * thumbnail (hqdefault, derived from the id — the same URL the cards
 * use) with a spinner, instead of a bare black rectangle for several
 * seconds. The facade is pointer-events-none and is removed the
 * moment the embed loads; it never covers the player, its controls
 * or its ads once playback is possible.
 */
export function YouTubePlayer({ youtubeVideoId }: YouTubePlayerProps) {
  const [loaded, setLoaded] = useState(false);
  const embedUrl = `https://www.youtube.com/embed/${encodeURIComponent(youtubeVideoId)}?rel=0&playsinline=1`;
  return (
    <View style={styles.wrap}>
      {React.createElement('iframe', {
        src: embedUrl,
        style: { width: '100%', height: '100%', border: 0 },
        allow:
          'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share',
        allowFullScreen: true,
        title: 'YouTube video player',
        onLoad: () => setLoaded(true),
      })}
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

const styles = StyleSheet.create({
  wrap: {
    width: '100%',
    aspectRatio: layout.thumbnailAspectRatio,
    backgroundColor: lightColors.playerBackground,
  },
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
