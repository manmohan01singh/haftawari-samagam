import React, { memo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { layout, lightColors, radii, spacing } from '../../theme';
import { formatDuration } from './VideoCard';
import type { CardVideoData } from './cardData';

interface ShelfCardProps {
  data: CardVideoData;
  onPress?: () => void;
  /**
   * Search "Latest videos" variant (reference §3): a 48px channel
   * avatar with a red ring and an overlapping LIVE pill sits left of
   * the title when the item is a live broadcast.
   */
  showAvatar?: boolean;
}

/**
 * Inset shelf/row card (reference §2–§3): thumbnail inset by the
 * parent's padding, radius 12, LIVE/duration pill bottom-right; below,
 * a 2-line semibold title with ••• at its right, then grey channel and
 * metadata lines. Used by Subscriptions, Search, Channel and Library.
 */
export const ShelfCard = memo(function ShelfCard({ data, onPress, showAvatar = false }: ShelfCardProps) {
  const isLive = data.broadcastState === 'live';
  return (
    <Pressable onPress={onPress} style={styles.card} accessibilityRole="button">
      <View style={styles.thumbnailWrap}>
        {data.thumbnailUrl ? (
          <Image
            recyclingKey={data.key}
            source={{ uri: data.thumbnailUrl }}
            style={styles.thumbnail}
            contentFit="cover"
            cachePolicy="memory-disk"
            transition={200}
          />
        ) : (
          <View style={[styles.thumbnail, styles.thumbnailEmpty]} />
        )}
        {isLive ? (
          <View style={styles.liveBadge}>
            <MaterialIcons name="sensors" size={14} color="#FFFFFF" />
            <Text style={styles.liveText}>LIVE</Text>
          </View>
        ) : data.durationSeconds != null ? (
          <View style={styles.durationBadge}>
            <Text style={styles.durationText}>{formatDuration(data.durationSeconds)}</Text>
          </View>
        ) : null}
      </View>
      <View style={styles.metaRow}>
        {showAvatar ? (
          <View style={styles.avatarWrap}>
            {data.channelAvatarUrl ? (
              <Image
                source={{ uri: data.channelAvatarUrl }}
                style={[styles.avatar, isLive && styles.avatarLiveRing]}
                contentFit="cover"
                cachePolicy="memory-disk"
              />
            ) : (
              <View style={[styles.avatar, styles.avatarFallback, isLive && styles.avatarLiveRing]}>
                <Text style={styles.avatarInitial}>{data.channelLine.replace('@', '').charAt(0).toUpperCase()}</Text>
              </View>
            )}
            {isLive ? (
              <View style={styles.avatarLivePill}>
                <Text style={styles.avatarLiveText}>LIVE</Text>
              </View>
            ) : null}
          </View>
        ) : null}
        <View style={styles.lines}>
          <View style={styles.titleRow}>
            <Text style={styles.title} numberOfLines={2}>
              {data.title}
            </Text>
            <MaterialIcons name="more-horiz" size={20} color={lightColors.text} style={styles.moreIcon} />
          </View>
          <Text style={styles.channel} numberOfLines={1}>
            {data.channelLine}
          </Text>
          {data.metaLine ? (
            <Text style={styles.meta} numberOfLines={1}>
              {data.metaLine}
            </Text>
          ) : null}
        </View>
      </View>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  card: { paddingBottom: spacing.xl },
  thumbnailWrap: { position: 'relative' },
  thumbnail: {
    width: '100%',
    aspectRatio: layout.thumbnailAspectRatio,
    borderRadius: radii.card,
    backgroundColor: lightColors.playerBackground,
  },
  thumbnailEmpty: { backgroundColor: lightColors.surfaceVariant },
  liveBadge: {
    position: 'absolute',
    right: spacing.sm,
    bottom: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: lightColors.accent,
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 3,
  },
  liveText: { color: '#FFFFFF', fontSize: 12, fontWeight: '700' },
  durationBadge: {
    position: 'absolute',
    right: spacing.sm,
    bottom: spacing.sm,
    backgroundColor: 'rgba(0,0,0,0.8)',
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 3,
  },
  durationText: { color: '#FFFFFF', fontSize: 12, fontWeight: '600' },
  metaRow: { flexDirection: 'row', marginTop: spacing.md, gap: spacing.md },
  avatarWrap: { position: 'relative', width: 48, height: 48 },
  avatar: { width: 48, height: 48, borderRadius: 24 },
  avatarLiveRing: { borderWidth: 2.5, borderColor: lightColors.accent },
  avatarFallback: {
    backgroundColor: lightColors.surfaceVariant,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitial: { fontSize: 18, fontWeight: '600', color: lightColors.textSecondary },
  avatarLivePill: {
    position: 'absolute',
    bottom: -6,
    alignSelf: 'center',
    backgroundColor: lightColors.accent,
    borderRadius: 4,
    paddingHorizontal: 5,
    paddingVertical: 1,
  },
  avatarLiveText: { color: '#FFFFFF', fontSize: 10, fontWeight: '700' },
  lines: { flex: 1 },
  titleRow: { flexDirection: 'row', alignItems: 'flex-start' },
  title: { flex: 1, fontSize: 16, lineHeight: 22, fontWeight: '600', color: lightColors.text },
  moreIcon: { marginLeft: spacing.sm, marginTop: 1 },
  channel: { fontSize: 13, color: lightColors.textSecondary, marginTop: 3 },
  meta: { fontSize: 13, color: lightColors.textSecondary, marginTop: 1 },
});
