import React, { memo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { formatDuration } from '../../../components/video/VideoCard';
import { listThumbnailUrl } from '../../../components/video/cardData';
import { layout, lightColors, nativeApp, radii, spacing, typography } from '../../../theme';
import type { SessionStatus } from '../../../types/database';
import { formatCountdown, formatSessionDateTime, formatStartedAgo } from '../format';
import type { SessionWithVideo } from '../sessionService';
import { SessionStatusBadge } from './SessionStatusBadge';

interface SessionCardProps {
  item: SessionWithVideo;
  /** Effective (server-clock derived) status — never the raw stored one alone. */
  effectiveStatus: Exclude<SessionStatus, 'cancelled'>;
  nowMs: number;
  onPress?: (sessionId: string) => void;
}

/**
 * Session card in the reference shelf style: inset 16:9 thumbnail
 * (radius 12), status badge bottom-right, 2-line title, one grey
 * schedule line. All text comes from the real session + video rows.
 */
export const SessionCard = memo(function SessionCard({ item, effectiveStatus, nowMs, onPress }: SessionCardProps) {
  const { session, video } = item;
  const title = session.title ?? video?.title ?? 'Samagam';
  // List-sized thumbnail (hqdefault) — the stored URL is the full-res
  // original and was being loaded for every card in the list.
  const thumbnailUrl = video
    ? listThumbnailUrl(video.youtube_video_id, video.thumbnail_url)
    : null;

  const scheduleLine =
    effectiveStatus === 'now_playing'
      ? formatStartedAgo(session.scheduled_start_at, nowMs)
      : effectiveStatus === 'upcoming'
        ? `${formatSessionDateTime(session.scheduled_start_at)} · ${formatCountdown(session.scheduled_start_at, nowMs)}`
        : formatSessionDateTime(session.scheduled_start_at);

  return (
    <Pressable
      onPress={() => onPress?.(session.id)}
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
      accessibilityRole="button"
      accessibilityLabel={title}
    >
      <View style={styles.thumbnailWrap}>
        {thumbnailUrl ? (
          <Image source={{ uri: thumbnailUrl }} style={styles.thumbnail} contentFit="cover" cachePolicy="memory-disk" recyclingKey={session.id} />
        ) : (
          <View style={[styles.thumbnail, styles.thumbnailEmpty]} />
        )}
        <View style={styles.badgeWrap}>
          <SessionStatusBadge status={effectiveStatus} />
        </View>
        {effectiveStatus === 'completed' && video?.duration_seconds != null ? (
          <View style={styles.durationBadge}>
            <Text style={styles.durationText}>{formatDuration(video.duration_seconds)}</Text>
          </View>
        ) : null}
      </View>
      <View style={styles.body}>
        <Text style={styles.title} numberOfLines={2}>
          {title}
        </Text>
        <Text style={styles.schedule} numberOfLines={1}>
          {scheduleLine}
        </Text>
        {video && effectiveStatus !== 'completed' ? (
          <Text style={styles.videoTitle} numberOfLines={1}>
            {video.title}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  card: {
    marginHorizontal: nativeApp.shelfCard.thumbnailInset,
    marginBottom: spacing.xl,
  },
  pressed: { opacity: 0.85 },
  thumbnailWrap: { position: 'relative' },
  thumbnail: {
    width: '100%',
    aspectRatio: layout.thumbnailAspectRatio,
    borderRadius: nativeApp.shelfCard.thumbnailRadius,
    backgroundColor: lightColors.surfaceVariant,
  },
  thumbnailEmpty: { backgroundColor: lightColors.surfaceVariant },
  badgeWrap: { position: 'absolute', left: spacing.sm, bottom: spacing.sm },
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
  body: { marginTop: spacing.md },
  title: { ...typography.cardTitle, color: lightColors.text },
  schedule: {
    ...typography.channelName,
    color: lightColors.textSecondary,
    marginTop: 2,
  },
  videoTitle: {
    ...typography.metadata,
    fontSize: 13,
    color: lightColors.textSecondary,
    marginTop: 1,
  },
});
