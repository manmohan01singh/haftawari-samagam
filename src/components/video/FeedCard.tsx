import React, { memo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { MaterialIcons } from '@expo/vector-icons';
import { layout, lightColors, nativeApp, spacing } from '../../theme';
import { formatDuration } from './VideoCard';
import { ICON_HIT_SLOP } from '../../lib/touch';
import type { CardVideoData } from './cardData';
import { CardActionSheet, type CardMenuAction } from '../common/CardActionSheet';

interface FeedCardProps {
  data: CardVideoData;
  onPress?: () => void;
  /** Bookmark state + action (real saved_videos backend; archive rows only). */
  saved?: boolean;
  onToggleSave?: () => void;
  onShare?: () => void;
  /** Tapping the channel avatar (QA 32) — real channel destination only. */
  onChannelPress?: () => void;
  /** Real actions for the ⋮ kebab menu (QA 31/32). Kebab renders only when provided. */
  menuActions?: CardMenuAction[];
}

/**
 * Home-feed card, geometry from the native-app reference
 * (docs/reference/REFERENCE_UI.md §1, screenshot 01):
 * full-bleed 16:9 thumbnail, LIVE/duration pill bottom-right (8px
 * inset), title full-width below (17px semibold, 2 lines), then the
 * avatar row — 40px avatar, @handle + metadata lines, and the inline
 * engagement row right-aligned with 24px icons and NO counts.
 *
 * Engagement actions render only when a real handler exists: Save
 * (saved_videos) and Share (system share sheet). Like/Comment have no
 * backend in the schema, so they are not shown as dead buttons.
 */
export const FeedCard = memo(function FeedCard({ data, onPress, saved, onToggleSave, onShare, onChannelPress, menuActions }: FeedCardProps) {
  const isLive = data.broadcastState === 'live';
  const [menuOpen, setMenuOpen] = React.useState(false);
  const avatar = data.channelAvatarUrl ? (
    <Image
      source={{ uri: data.channelAvatarUrl }}
      style={styles.avatar}
      contentFit="cover"
      cachePolicy="memory-disk"
    />
  ) : (
    <View style={[styles.avatar, styles.avatarFallback]}>
      <Text style={styles.avatarInitial}>{data.channelLine.replace('@', '').charAt(0).toUpperCase()}</Text>
    </View>
  );
  return (
    <>
    <Pressable onPress={onPress} style={styles.card} accessibilityRole="button">
      <View style={styles.thumbnailWrap}>
        {data.thumbnailUrl ? (
          <Image
            source={{ uri: data.thumbnailUrl }}
            style={styles.thumbnail}
            contentFit="cover"
            cachePolicy="memory-disk"
            transition={150}
            pointerEvents="none"
          />
        ) : (
          <View style={[styles.thumbnail, styles.thumbnailEmpty]} />
        )}
        {isLive ? (
          <View style={styles.liveBadge} pointerEvents="none">
            <MaterialIcons name="sensors" size={14} color="#FFFFFF" />
            <Text style={styles.liveText}>LIVE</Text>
          </View>
        ) : data.durationSeconds != null ? (
          <View style={styles.durationBadge} pointerEvents="none">
            <Text style={styles.durationText}>{formatDuration(data.durationSeconds)}</Text>
          </View>
        ) : null}
      </View>
      <View style={styles.body}>
        <Text style={styles.title} numberOfLines={2}>
          {data.title}
        </Text>
        <View style={styles.row}>
          {onChannelPress ? (
            <Pressable
              onPress={onChannelPress}
              hitSlop={6}
              accessibilityRole="button"
              accessibilityLabel={`Open channel ${data.channelLine}`}
            >
              {avatar}
            </Pressable>
          ) : (
            avatar
          )}
          <View style={styles.lines}>
            <Text style={styles.handle} numberOfLines={1}>
              {data.channelLine}
            </Text>
            {data.metaLine ? (
              <Text style={styles.meta} numberOfLines={1}>
                {data.metaLine}
              </Text>
            ) : null}
          </View>
          <View style={styles.engagement}>
            {onToggleSave ? (
              <Pressable onPress={onToggleSave} hitSlop={ICON_HIT_SLOP} accessibilityLabel={saved ? 'Remove from saved' : 'Save'} accessibilityRole="button">
                <MaterialIcons name={saved ? 'bookmark' : 'bookmark-border'} size={24} color={lightColors.text} />
              </Pressable>
            ) : null}
            {onShare ? (
              <Pressable onPress={onShare} hitSlop={ICON_HIT_SLOP} accessibilityLabel="Share" accessibilityRole="button">
                <MaterialIcons name="share" size={22} color={lightColors.text} />
              </Pressable>
            ) : null}
            {menuActions && menuActions.length > 0 ? (
              <Pressable
                onPress={() => setMenuOpen(true)}
                hitSlop={ICON_HIT_SLOP}
                accessibilityLabel="More actions"
                accessibilityRole="button"
              >
                <MaterialIcons name="more-vert" size={24} color={lightColors.text} />
              </Pressable>
            ) : null}
          </View>
        </View>
      </View>
    </Pressable>
    {menuActions && menuActions.length > 0 ? (
      <CardActionSheet visible={menuOpen} onClose={() => setMenuOpen(false)} actions={menuActions} />
    ) : null}
    </>
  );
});

const styles = StyleSheet.create({
  card: { backgroundColor: lightColors.background, paddingBottom: spacing.lg },
  thumbnailWrap: { position: 'relative' },
  thumbnail: {
    width: '100%',
    aspectRatio: layout.thumbnailAspectRatio,
    backgroundColor: lightColors.playerBackground,
  },
  thumbnailEmpty: { backgroundColor: lightColors.surfaceVariant },
  liveBadge: {
    position: 'absolute',
    right: nativeApp.feedCard.badgeInset,
    bottom: nativeApp.feedCard.badgeInset,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: lightColors.accent,
    borderRadius: nativeApp.feedCard.liveBadgeRadius,
    paddingHorizontal: 6,
    paddingVertical: 3,
  },
  liveText: { color: '#FFFFFF', fontSize: 12, fontWeight: '700' },
  durationBadge: {
    position: 'absolute',
    right: nativeApp.feedCard.badgeInset,
    bottom: nativeApp.feedCard.badgeInset,
    backgroundColor: 'rgba(0,0,0,0.8)',
    borderRadius: nativeApp.feedCard.liveBadgeRadius,
    paddingHorizontal: 6,
    paddingVertical: 3,
  },
  durationText: { color: '#FFFFFF', fontSize: 12, fontWeight: '600' },
  body: { paddingHorizontal: nativeApp.feedCard.bodyPadding, paddingTop: spacing.md },
  title: { fontSize: 17, lineHeight: 23, fontWeight: '600', color: lightColors.text },
  row: { flexDirection: 'row', alignItems: 'center', marginTop: 10, gap: spacing.md },
  avatar: { width: 40, height: 40, borderRadius: 20 },
  avatarFallback: {
    backgroundColor: lightColors.surfaceVariant,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitial: { fontSize: 16, fontWeight: '600', color: lightColors.textSecondary },
  lines: { flex: 1 },
  handle: { fontSize: 14, color: lightColors.textSecondary },
  meta: { fontSize: 14, color: lightColors.textSecondary, marginTop: 1 },
  engagement: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: nativeApp.feedCard.engagementRow.iconGap,
  },
});
