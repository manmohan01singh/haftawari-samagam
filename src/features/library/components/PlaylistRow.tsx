import React, { memo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { layout, lightColors, nativeApp, radii, spacing } from '../../../theme';
import type { PlaylistSummary } from '../types';
import { downgradeYouTubeThumbnailUrl } from '../../../components/video/cardData';

interface PlaylistRowProps {
  summary: PlaylistSummary;
  onPress: (summary: PlaylistSummary) => void;
  /**
   * ⋮ menu handler. When omitted the ⋮ is NOT rendered — a decorative
   * dots icon that does nothing is a dead button (it shipped that way
   * and read as broken on tap).
   */
  onMenu?: (summary: PlaylistSummary) => void;
}

/**
 * Stacked playlist row (reference §4): cover thumbnail ≈40% width with
 * a smaller offset layer peeking behind its top edge (the "stack of
 * videos" effect), playlist title + real meta at right. The cover is
 * the first item's real YouTube thumbnail; an empty playlist shows a
 * plain surface with a playlist glyph — never a fabricated image.
 */
export const PlaylistRow = memo(function PlaylistRow({ summary, onPress, onMenu }: PlaylistRowProps) {
  const { playlist, itemCount, coverThumbnailUrl, isOwn } = summary;
  const metaParts = [
    playlist.is_public ? 'Public' : 'Private',
    `${itemCount} ${itemCount === 1 ? 'recording' : 'recordings'}`,
  ];
  if (!isOwn && !playlist.is_public) metaParts.push('Shared with you');

  return (
    <Pressable
      style={styles.row}
      onPress={() => onPress(summary)}
      accessibilityRole="button"
      accessibilityLabel={playlist.title}
    >
      <View style={styles.thumbWrap}>
        <View style={styles.stackEdge} pointerEvents="none" />
        {coverThumbnailUrl ? (
          <Image
            source={{ uri: downgradeYouTubeThumbnailUrl(coverThumbnailUrl) }}
            style={styles.thumb}
            contentFit="cover"
            cachePolicy="memory-disk"
            recyclingKey={playlist.id}
          />
        ) : (
          <View style={[styles.thumb, styles.thumbEmpty]}>
            <MaterialIcons name="playlist-play" size={30} color={lightColors.textSecondary} />
          </View>
        )}
        <View style={styles.countBadge} pointerEvents="none">
          <MaterialIcons name="playlist-play" size={14} color="#FFFFFF" />
          <Text style={styles.countText}>{itemCount}</Text>
        </View>
      </View>
      <View style={styles.lines}>
        <Text style={styles.title} numberOfLines={2}>
          {playlist.title}
        </Text>
        <Text style={styles.meta} numberOfLines={1}>
          {metaParts.join(' · ')}
        </Text>
      </View>
      {onMenu ? (
        <Pressable
          onPress={() => onMenu(summary)}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel={`More actions for ${playlist.title}`}
          style={styles.menuButton}
        >
          <MaterialIcons name="more-vert" size={20} color={lightColors.textSecondary} />
        </Pressable>
      ) : null}
    </Pressable>
  );
});

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
    paddingVertical: spacing.sm,
  },
  thumbWrap: {
    width: `${nativeApp.stackedPlaylist.thumbnailWidthRatio * 100}%`,
    maxWidth: 168,
    position: 'relative',
    paddingTop: nativeApp.stackedPlaylist.stackOffset,
  },
  stackEdge: {
    position: 'absolute',
    top: 0,
    left: 6,
    right: 6,
    height: 10,
    borderTopLeftRadius: radii.card,
    borderTopRightRadius: radii.card,
    backgroundColor: lightColors.border,
  },
  thumb: {
    width: '100%',
    aspectRatio: layout.thumbnailAspectRatio,
    borderRadius: radii.card,
    backgroundColor: lightColors.surfaceVariant,
  },
  thumbEmpty: {
    backgroundColor: lightColors.surfaceVariant,
    alignItems: 'center',
    justifyContent: 'center',
  },
  countBadge: {
    position: 'absolute',
    right: spacing.xs + 2,
    bottom: spacing.xs + 2,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    backgroundColor: 'rgba(0,0,0,0.8)',
    borderRadius: radii.badge,
    paddingHorizontal: spacing.xs + 2,
    paddingVertical: 2,
  },
  countText: { color: '#FFFFFF', fontSize: 11, fontWeight: '600' },
  lines: { flex: 1 },
  menuButton: { padding: 4 },
  title: { fontSize: 17, fontWeight: '500', color: lightColors.text },
  meta: { fontSize: 13, color: lightColors.textSecondary, marginTop: 3 },
});
