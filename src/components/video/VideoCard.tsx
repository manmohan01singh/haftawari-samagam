import React, { memo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import type { Video } from '../../types/database';
import { layout, lightColors, radii, spacing, typography } from '../../theme';
import { UserAvatar } from '../common/UserAvatar';

interface VideoCardProps {
  video: Video;
  /** Real view metadata line supplied by the caller (never fabricated here). */
  metadataLine?: string;
  onPress?: (video: Video) => void;
  /** Real channel avatar URL when the caller has one (the Video row itself carries no channel fields). */
  channelAvatarUrl?: string | null;
  /** Channel name/handle for the avatar's initial fallback. */
  channelName?: string | null;
}

/**
 * Video card with the audited proportions: 16:9 thumbnail, 12px radius,
 * duration badge bottom-right, 36px channel avatar, 2-line title,
 * grey channel + metadata lines. Renders only the real `Video` row it
 * is given.
 *
 * Phase 9 W2 (audit §7): the declared `onPress` is actually wired —
 * the card is a Pressable that calls `onPress(video)` (it previously
 * rendered an unpressable View) — and the avatar slot renders a real
 * avatar (caller-supplied image, else the channel initial, else the
 * generic person treatment via UserAvatar) instead of an empty
 * placeholder View.
 */
export const VideoCard = memo(function VideoCard({
  video,
  metadataLine,
  onPress,
  channelAvatarUrl,
  channelName,
}: VideoCardProps) {
  const initial = channelName?.replace('@', '').charAt(0).toUpperCase() ?? null;
  return (
    <Pressable
      onPress={onPress ? () => onPress(video) : undefined}
      disabled={!onPress}
      style={styles.card}
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={video.title}
    >
      <View style={styles.thumbnailWrap}>
        {video.thumbnail_url ? (
          <Image source={{ uri: video.thumbnail_url }} style={styles.thumbnail} contentFit="cover" cachePolicy="memory-disk" recyclingKey={video.id} />
        ) : (
          <View style={[styles.thumbnail, styles.thumbnailEmpty]} />
        )}
        {video.duration_seconds != null ? (
          <View style={styles.durationBadge}>
            <Text style={styles.durationText}>{formatDuration(video.duration_seconds)}</Text>
          </View>
        ) : null}
      </View>
      <View style={styles.metaRow}>
        <UserAvatar avatarUrl={channelAvatarUrl} initial={initial} size={layout.avatarSm} />
        <View style={styles.metaText}>
          <Text style={styles.title} numberOfLines={2}>
            {video.title}
          </Text>
          {metadataLine ? (
            <Text style={styles.metadata} numberOfLines={1}>
              {metadataLine}
            </Text>
          ) : null}
        </View>
      </View>
    </Pressable>
  );
});

export function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m);
  const ss = String(sec).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

const styles = StyleSheet.create({
  card: { marginBottom: spacing.lg },
  thumbnailWrap: { position: 'relative' },
  thumbnail: {
    width: '100%',
    aspectRatio: layout.thumbnailAspectRatio,
    borderRadius: radii.card,
    backgroundColor: lightColors.surfaceVariant,
  },
  thumbnailEmpty: { backgroundColor: lightColors.surfaceVariant },
  durationBadge: {
    position: 'absolute',
    right: spacing.sm,
    bottom: spacing.sm,
    backgroundColor: 'rgba(0,0,0,0.8)',
    borderRadius: radii.badge,
    paddingHorizontal: spacing.xs + 2,
    paddingVertical: 2,
  },
  durationText: { color: '#FFFFFF', fontSize: 12, fontWeight: '600' },
  metaRow: { flexDirection: 'row', marginTop: spacing.md, gap: layout.cardInnerGap },
  metaText: { flex: 1 },
  title: { ...typography.cardTitle, color: lightColors.text },
  metadata: { ...typography.metadata, color: lightColors.textSecondary, marginTop: 2 },
});
