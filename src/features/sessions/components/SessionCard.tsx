import React, { memo, useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { formatDuration } from '../../../components/video/VideoCard';
import { listThumbnailUrl } from '../../../components/video/cardData';
import { layout, nativeApp, radii, spacing, typography, useTheme, type ThemeColors } from '../../../theme';
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
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
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
          // No thumbnail on the row (e.g. a hosted phone recording
          // whose admin has not added one): the brand mark, exactly
          // as FeedCard falls back — never a bare grey rectangle
          // (mobile sweep, 27 Nov 2026: session thumbnails read as
          // broken blanks while Home cards showed the mark).
          <View style={[styles.thumbnail, styles.thumbnailEmpty]}>
            <Image
              source={require('../../../../assets/icon.png')}
              style={styles.thumbnailFallbackMark}
              contentFit="contain"
            />
          </View>
        )}
        {/* Status badge bottom-RIGHT, matching the reference LIVE-pill
            position on shelf/feed thumbnails (REFERENCE_UI §1/§2);
            previously it sat bottom-left, unlike every other card. */}
        <View style={styles.badgeWrap} pointerEvents="none">
          <SessionStatusBadge status={effectiveStatus} />
        </View>
        {effectiveStatus === 'completed' && video?.duration_seconds != null ? (
          <View style={styles.durationBadge} pointerEvents="none">
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

const createStyles = (colors: ThemeColors) => StyleSheet.create({
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
    backgroundColor: colors.surfaceVariant,
  },
  thumbnailEmpty: {
    backgroundColor: colors.surfaceVariant,
    alignItems: 'center',
    justifyContent: 'center',
  },
  thumbnailFallbackMark: { width: 56, height: 56, opacity: 0.9 },
  badgeWrap: { position: 'absolute', right: spacing.sm, bottom: spacing.sm },
  durationBadge: {
    position: 'absolute',
    left: spacing.sm,
    bottom: spacing.sm,
    backgroundColor: 'rgba(0,0,0,0.8)',
    borderRadius: radii.badge,
    paddingHorizontal: spacing.xs + 2,
    paddingVertical: 2,
  },
  durationText: { color: '#FFFFFF', fontSize: 12, fontWeight: '600' },
  body: { marginTop: spacing.md },
  title: { ...typography.cardTitle, color: colors.text },
  schedule: {
    ...typography.channelName,
    color: colors.textSecondary,
    marginTop: 2,
  },
  videoTitle: {
    ...typography.metadata,
    fontSize: 13,
    color: colors.textSecondary,
    marginTop: 1,
  },
});
