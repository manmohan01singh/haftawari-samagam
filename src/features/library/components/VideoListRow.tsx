import React, { memo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { layout, lightColors, radii, spacing, typography } from '../../../theme';
import type { Video } from '../../../types/database';
import { SMALL_ICON_HIT_SLOP } from '../../../lib/touch';
import { formatClock, resumeRatio } from '../format';
import { listThumbnailUrl } from '../../../components/video/cardData';

interface VideoListRowProps {
  video: Video;
  /** Grey line under the title (real data only — dates, counts). */
  metaLine?: string;
  /** Resume position in seconds (history rows); shown when > 0. */
  resumePositionSeconds?: number;
  onPress: (video: Video) => void;
  /** Icon-button rendered at the row's right edge (e.g. remove/unsave). */
  actionIcon?: 'close' | 'bookmark';
  actionLabel?: string;
  onAction?: () => void;
}

/**
 * Compact list row used by History, Saved and Playlist detail:
 * thumbnail ≈40% width at left (radius 12, duration badge, red resume
 * progress bar at its bottom edge), title + meta at right — the
 * stacked-row geometry of reference §4, generalised to a video row.
 */
export const VideoListRow = memo(function VideoListRow({
  video,
  metaLine,
  resumePositionSeconds,
  onPress,
  actionIcon,
  actionLabel,
  onAction,
}: VideoListRowProps) {
  const ratio = resumePositionSeconds != null ? resumeRatio(resumePositionSeconds, video.duration_seconds) : null;
  const thumbUrl = listThumbnailUrl(video.youtube_video_id, video.thumbnail_url);
  const metaParts: string[] = [];
  if (metaLine) metaParts.push(metaLine);
  if (resumePositionSeconds != null && resumePositionSeconds > 0) {
    metaParts.push(`Left at ${formatClock(resumePositionSeconds)}`);
  }

  return (
    <Pressable
      style={styles.row}
      onPress={() => onPress(video)}
      accessibilityRole="button"
      accessibilityLabel={video.title}
    >
      <View style={styles.thumbWrap}>
        {thumbUrl ? (
          <Image
            source={{ uri: thumbUrl }}
            style={styles.thumb}
            contentFit="cover"
            cachePolicy="memory-disk"
            recyclingKey={video.id}
          />
        ) : (
          <View style={[styles.thumb, styles.thumbEmpty]} />
        )}
        {video.duration_seconds != null ? (
          <View style={styles.durationBadge} pointerEvents="none">
            <Text style={styles.durationText}>{formatClock(video.duration_seconds)}</Text>
          </View>
        ) : null}
        {ratio != null ? (
          <View style={styles.progressTrack} pointerEvents="none">
            <View style={[styles.progressFill, { width: `${Math.round(ratio * 100)}%` }]} />
          </View>
        ) : null}
      </View>
      <View style={styles.lines}>
        <Text style={styles.title} numberOfLines={2}>
          {video.title}
        </Text>
        {metaParts.length > 0 ? (
          <Text style={styles.meta} numberOfLines={1}>
            {metaParts.join(' · ')}
          </Text>
        ) : null}
      </View>
      {actionIcon && onAction ? (
        <Pressable
          style={styles.actionButton}
          onPress={onAction}
          hitSlop={SMALL_ICON_HIT_SLOP}
          accessibilityRole="button"
          accessibilityLabel={actionLabel ?? 'Remove'}
        >
          <MaterialIcons
            name={actionIcon === 'bookmark' ? 'bookmark' : 'close'}
            size={20}
            color={lightColors.textSecondary}
          />
        </Pressable>
      ) : null}
    </Pressable>
  );
});

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    paddingVertical: spacing.sm,
  },
  thumbWrap: { width: '40%', maxWidth: 168, position: 'relative' },
  thumb: {
    width: '100%',
    aspectRatio: layout.thumbnailAspectRatio,
    borderRadius: radii.card,
    backgroundColor: lightColors.surfaceVariant,
  },
  thumbEmpty: { backgroundColor: lightColors.surfaceVariant },
  durationBadge: {
    position: 'absolute',
    right: spacing.xs + 2,
    bottom: spacing.xs + 2,
    backgroundColor: 'rgba(0,0,0,0.8)',
    borderRadius: radii.badge,
    paddingHorizontal: spacing.xs + 2,
    paddingVertical: 2,
  },
  durationText: { color: '#FFFFFF', fontSize: 11, fontWeight: '600' },
  progressTrack: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 3,
    backgroundColor: 'rgba(255,255,255,0.4)',
    borderBottomLeftRadius: radii.card,
    borderBottomRightRadius: radii.card,
    overflow: 'hidden',
  },
  progressFill: { height: '100%', backgroundColor: lightColors.accent },
  lines: { flex: 1, paddingTop: 2 },
  title: { ...typography.body, fontSize: 15, lineHeight: 20, fontWeight: '600', color: lightColors.text },
  meta: { ...typography.metadata, fontSize: 13, color: lightColors.textSecondary, marginTop: 3 },
  actionButton: { padding: spacing.xs, marginTop: 2 },
});
