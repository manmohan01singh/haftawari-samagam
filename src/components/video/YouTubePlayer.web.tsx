import React from 'react';
import { StyleSheet, View } from 'react-native';
import { layout, lightColors } from '../../theme';

interface YouTubePlayerProps {
  youtubeVideoId: string;
}

/**
 * Official YouTube embedded player (web / PWA): a plain iframe embed.
 * Same rule as native — YouTube's own player, branding, ads and
 * controls, untouched. (Metro resolves this .web variant on web.)
 */
export function YouTubePlayer({ youtubeVideoId }: YouTubePlayerProps) {
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
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    width: '100%',
    aspectRatio: layout.thumbnailAspectRatio,
    backgroundColor: lightColors.playerBackground,
  },
});
