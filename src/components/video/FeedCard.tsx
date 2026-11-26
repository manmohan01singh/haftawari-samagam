import React, { memo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
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
  /**
   * `feed` (default) = Home card container per screenshot 01: full-bleed
   * thumbnail, white body with rounded bottom corners on the grey page,
   * title full-width ABOVE the avatar row, and the engagement row
   * right-aligned on the avatar row. QA issue 48 guardrail: only REAL
   * actions are wired — bookmark (saved_videos), share (system sheet)
   * and ••• (opens the recording, where save/playlist/share live).
   * Like/comment have no backend in this app and are NOT rendered as
   * dead icons; they are flagged in the QA report instead.
   * `upNext` = compact horizontal row (QA issue 57): small 16:9 thumb
   * at left, title + channel/meta at right, ⋮ at the far right.
   */
  variant?: 'feed' | 'upNext';
  /** Tapping the channel avatar (QA 32) — real channel destination only. */
  onChannelPress?: () => void;
  /** Real actions for the ⋮ kebab menu (QA 31/32). When provided, the
   * engagement-row kebab opens a CardActionSheet with these actions
   * instead of falling back to opening the recording. */
  menuActions?: CardMenuAction[];
}

/**
 * Home-feed card, geometry from the native-app reference
 * (docs/reference/REFERENCE_UI.md §1, screenshot 01).
 *
 * Engagement row: all four reference icons are always rendered (the
 * screenshot is the source of truth for this row). Bookmark uses the
 * real saved_videos handler when one is supplied; comment and ••• fall
 * back to real destinations (open the recording / system share sheet);
 * the thumb is a local pressed-state toggle only — no count is ever
 * shown or invented.
 */
export const FeedCard = memo(function FeedCard({
  data,
  onPress,
  saved,
  onToggleSave,
  onShare,
  variant = 'feed',
  onChannelPress,
  menuActions,
}: FeedCardProps) {
  const isLive = data.broadcastState === 'live';
  const isUpNext = variant === 'upNext';
  const [menuOpen, setMenuOpen] = React.useState(false);
  const hasMenu = !!menuActions && menuActions.length > 0;

  const thumbnail = (
    <View style={styles.thumbnailWrap}>
      {data.thumbnailUrl ? (
        <Image
          recyclingKey={data.key}
          source={{ uri: data.thumbnailUrl }}
          style={styles.thumbnail}
          contentFit="cover"
          cachePolicy="memory-disk"
          transition={200}
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
  );
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
  if (isUpNext) {
    // QA issue 57: Up Next is a COMPACT HORIZONTAL row — small 16:9
    // thumbnail at left (~40% width, radius 8, duration/LIVE chip on
    // it), title + channel/meta lines at right, ⋮ at the far right.
    // (QA issue 61: titles use explicit tail ellipsis.)
    const metaParts = [data.channelLine, data.metaLine].filter(Boolean);
    return (
      <>
      <Pressable onPress={onPress} style={styles.upNextCard} accessibilityRole="button">
        <View style={styles.upNextThumbWrap}>
          {data.thumbnailUrl ? (
            <Image
              source={{ uri: data.thumbnailUrl }}
              style={styles.upNextThumb}
              contentFit="cover"
              cachePolicy="memory-disk"
              transition={150}
            />
          ) : (
            <View style={[styles.upNextThumb, styles.thumbnailEmpty]} />
          )}
          {isLive ? (
            <View style={styles.upNextBadge}>
              <Text style={styles.liveText}>LIVE</Text>
            </View>
          ) : data.durationSeconds != null ? (
            <View style={styles.upNextBadge}>
              <Text style={styles.durationText}>{formatDuration(data.durationSeconds)}</Text>
            </View>
          ) : null}
        </View>
        <View style={styles.lines}>
          <Text style={styles.upNextTitle} numberOfLines={2} ellipsizeMode="tail">
            {data.title}
          </Text>
          {metaParts.length > 0 ? (
            <Text style={styles.upNextMeta} numberOfLines={2} ellipsizeMode="tail">
              {metaParts.join('\n')}
            </Text>
          ) : null}
        </View>
        <Pressable
          onPress={hasMenu ? () => setMenuOpen(true) : (onShare ?? onPress)}
          hitSlop={8}
          accessibilityLabel="More actions"
          accessibilityRole="button"
          style={styles.moreButton}
        >
          <MaterialIcons name="more-vert" size={20} color={lightColors.text} />
        </Pressable>
      </Pressable>
      {hasMenu ? (
        <CardActionSheet visible={menuOpen} onClose={() => setMenuOpen(false)} actions={menuActions} />
      ) : null}
      </>
    );
  }

  return (
    <>
    <Pressable onPress={onPress} style={styles.card} accessibilityRole="button">
      {thumbnail}
      <View style={styles.body}>
        <Text style={styles.title} numberOfLines={2} ellipsizeMode="tail">
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
            <Text style={styles.handle} numberOfLines={1} ellipsizeMode="tail">
              {data.channelLine}
            </Text>
            {data.metaLine ? (
              <Text style={styles.meta} numberOfLines={1} ellipsizeMode="tail">
                {data.metaLine}
              </Text>
            ) : null}
          </View>
          {/* Engagement row (QA 48/69): right-aligned, inside the card
              body, 24px icons with even spacing, no counts — and only
              real actions: Save (bookmark), Share, ••• (more). */}
          <View style={styles.engagement}>
            <Pressable
              onPress={onToggleSave ?? onPress}
              hitSlop={ICON_HIT_SLOP}
              accessibilityLabel={saved ? 'Remove from saved' : 'Save'}
              accessibilityState={{ selected: !!saved }}
              accessibilityRole="button"
            >
              <MaterialIcons name={saved ? 'bookmark' : 'bookmark-border'} size={24} color={lightColors.text} />
            </Pressable>
            <Pressable
              onPress={onShare ?? onPress}
              hitSlop={ICON_HIT_SLOP}
              accessibilityLabel="Share"
              accessibilityRole="button"
            >
              <MaterialIcons name="share" size={22} color={lightColors.text} />
            </Pressable>
            {hasMenu ? (
              <Pressable
                onPress={() => setMenuOpen(true)}
                hitSlop={ICON_HIT_SLOP}
                accessibilityLabel="More actions"
                accessibilityRole="button"
              >
                <MaterialIcons name="more-vert" size={24} color={lightColors.text} />
              </Pressable>
            ) : (
              <Pressable
                onPress={onPress}
                hitSlop={ICON_HIT_SLOP}
                accessibilityLabel="More actions"
                accessibilityRole="button"
              >
                <MaterialIcons name="more-horiz" size={24} color={lightColors.text} />
              </Pressable>
            )}
          </View>
        </View>
      </View>
    </Pressable>
    {hasMenu ? (
      <CardActionSheet visible={menuOpen} onClose={() => setMenuOpen(false)} actions={menuActions} />
    ) : null}
    </>
  );
});

const styles = StyleSheet.create({
  // Card container (screenshot 01): the white body carries rounded
  // bottom corners and the cards sit on the page's light-grey ground,
  // separated by ~20px of that ground — not white-on-white.
  // QA issue 53: card rhythm is ~12px of page ground between cards
  // (the grey ground itself is the divider).
  card: { marginBottom: 12 },
  thumbnailWrap: { position: 'relative' },
  thumbnail: {
    width: '100%',
    aspectRatio: layout.thumbnailAspectRatio,
    // Light placeholder while the image is in flight (QA issue 7) —
    // this was playerBackground (pure black), so every slow thumbnail
    // read as a black rectangle. Matches the skeleton colour.
    backgroundColor: lightColors.surfaceVariant,
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
  body: {
    backgroundColor: lightColors.surface,
    borderBottomLeftRadius: 20,
    borderBottomRightRadius: 20,
    paddingHorizontal: nativeApp.feedCard.bodyPadding,
    paddingTop: spacing.md,
    paddingBottom: spacing.md,
  },
  // QA issue 52: reference card titles are ~15-16px, two lines max.
  title: { fontSize: 16, lineHeight: 22, fontWeight: '600', color: lightColors.text },
  row: { flexDirection: 'row', alignItems: 'center', marginTop: 10, gap: spacing.md },
  avatar: { width: 40, height: 40, borderRadius: 20 },
  avatarFallback: {
    backgroundColor: lightColors.surfaceVariant,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitial: { fontSize: 16, fontWeight: '600', color: lightColors.textSecondary },
  lines: { flex: 1, minWidth: 0 },
  handle: { fontSize: 14, color: lightColors.textSecondary },
  meta: { fontSize: 14, color: lightColors.textSecondary, marginTop: 1 },
  engagement: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: nativeApp.feedCard.engagementRow.iconGap,
    flexShrink: 0,
  },
  // Up Next compact row (QA 57): horizontal, flat on the white sheet.
  upNextCard: {
    backgroundColor: lightColors.surface,
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: nativeApp.feedCard.bodyPadding,
    paddingVertical: spacing.sm + 2,
    gap: spacing.md,
  },
  upNextThumbWrap: { position: 'relative', width: '38%', maxWidth: 168 },
  upNextThumb: {
    width: '100%',
    aspectRatio: layout.thumbnailAspectRatio,
    borderRadius: 8,
    backgroundColor: lightColors.playerBackground,
  },
  upNextBadge: {
    position: 'absolute',
    right: 4,
    bottom: 4,
    backgroundColor: 'rgba(0,0,0,0.8)',
    borderRadius: 4,
    paddingHorizontal: 4,
    paddingVertical: 2,
  },
  upNextTitle: { fontSize: 15, lineHeight: 20, fontWeight: '600', color: lightColors.text },
  upNextMeta: { fontSize: 13, lineHeight: 18, color: lightColors.textSecondary, marginTop: 3 },
  moreButton: { marginTop: 1 },
});
