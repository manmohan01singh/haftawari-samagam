import React, { memo, useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { layout, nativeApp, radii, spacing, typography, useTheme, type ThemeColors } from '../../theme';
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
   * `feed` (default) = Home card per screenshot 01: full-bleed
   * thumbnail, FLAT white body (Phase 9 W2 / audit D4 — no shadow, no
   * rounded corners; cards separated by 16px of page ground), title
   * full-width ABOVE the avatar row, and the engagement row
   * right-aligned on the avatar row. QA issue 48 guardrail: only REAL
   * actions are rendered — Save shows only with a real saved_videos
   * handler, Share only with a real share handler, ••• only with real
   * menu actions (Phase 9 W2 / audit §7: no fallback to opening the
   * recording). Like/comment have no backend in this app and are NOT
   * rendered as dead icons; they are flagged in the QA report instead.
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
 * Engagement row: only actions with a real handler are rendered
 * (Phase 9 W2). Bookmark uses the real saved_videos handler, Share the
 * real share handler, ••• a real CardActionSheet menu — an action with
 * no handler is omitted, never wired to open the recording. No count
 * is ever shown or invented.
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
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
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
        <View style={[styles.thumbnail, styles.thumbnailEmpty]}>
          <Image
            source={require('../../../assets/icon.png')}
            style={styles.thumbnailFallbackMark}
            contentFit="contain"
          />
        </View>
      )}
      {isLive ? (
        <View style={styles.liveBadge} pointerEvents="none">
          <MaterialIcons name="sensors" size={14} color="#FFFFFF" />
          <Text style={styles.liveText}>LIVE</Text>
        </View>
      ) : data.nowPlayingSession ? (
        <View style={styles.liveBadge} pointerEvents="none">
          <Text style={styles.liveText}>NOW PLAYING</Text>
        </View>
      ) : data.upcomingSession ? (
        <View style={styles.upcomingBadge} pointerEvents="none">
          <MaterialIcons name="schedule" size={13} color="#FFFFFF" />
          <Text style={styles.liveText}>UPCOMING</Text>
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
    return (
      <>
      <Pressable
        onPress={onPress}
        style={({ pressed }) => [styles.upNextCard, pressed && styles.cardPressed]}
        accessibilityRole="button"
      >
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
            <View style={[styles.upNextThumb, styles.thumbnailEmpty]}>
              <Image
                source={require('../../../assets/icon.png')}
                style={styles.upNextFallbackMark}
                contentFit="contain"
              />
            </View>
          )}
          {isLive ? (
            <View style={[styles.upNextBadge, styles.upNextLiveBadge]}>
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
          {/* Channel line and meta as SEPARATE single-line texts:
              joined into one 2-line Text, a long handle
              (@bhaigursharansinghjiofficial) wrapped MID-WORD onto
              the second line instead of ellipsizing (mobile sweep,
              27 Nov 2026). One line each → tail ellipsis works. */}
          {data.channelLine ? (
            <Text style={styles.upNextMeta} numberOfLines={1} ellipsizeMode="tail">
              {data.channelLine}
            </Text>
          ) : null}
          {data.metaLine ? (
            <Text style={styles.upNextMetaSub} numberOfLines={1} ellipsizeMode="tail">
              {data.metaLine}
            </Text>
          ) : null}
        </View>
        {hasMenu ? (
          <Pressable
            onPress={() => setMenuOpen(true)}
            accessibilityLabel="More actions"
            accessibilityRole="button"
            style={styles.moreButton}
          >
            <MaterialIcons name="more-vert" size={20} color={colors.text} />
          </Pressable>
        ) : null}
      </Pressable>
      {hasMenu ? (
        <CardActionSheet visible={menuOpen} onClose={() => setMenuOpen(false)} actions={menuActions} />
      ) : null}
      </>
    );
  }

  return (
    <>
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
      accessibilityRole="button"
    >
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
          {/* Engagement row (QA 48/69, Phase 9 W2): right-aligned,
              inside the card body, 24px icons with even spacing, no
              counts — and only real actions: each icon renders ONLY
              when its handler exists (audit §7 fallback fix). */}
          <View style={styles.engagement}>
            {onToggleSave ? (
              <Pressable
                onPress={onToggleSave}
                hitSlop={ICON_HIT_SLOP}
                accessibilityLabel={saved ? 'Remove from saved' : 'Save'}
                accessibilityState={{ selected: !!saved }}
                accessibilityRole="button"
              >
                <MaterialIcons name={saved ? 'bookmark' : 'bookmark-border'} size={24} color={colors.text} />
              </Pressable>
            ) : null}
            {onShare ? (
              <Pressable
                onPress={onShare}
                hitSlop={ICON_HIT_SLOP}
                accessibilityLabel="Share"
                accessibilityRole="button"
              >
                <MaterialIcons name="share" size={24} color={colors.text} />
              </Pressable>
            ) : null}
            {hasMenu ? (
              <Pressable
                onPress={() => setMenuOpen(true)}
                hitSlop={ICON_HIT_SLOP}
                accessibilityLabel="More actions"
                accessibilityRole="button"
              >
                <MaterialIcons name="more-horiz" size={24} color={colors.text} />
              </Pressable>
            ) : null}
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

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  // Phase 9 W2 (audit D4): the reference home card is FLAT — full-bleed
  // thumbnail with no corner radius, flat white body, no shadow; cards
  // are separated by 16px of page ground. (The round-2 floating-card
  // treatment — shadow, 16dp top / 20dp bottom radii, 12px gap — was
  // measured against the reference and rejected by the forensic audit.)
  card: {
    marginBottom: spacing.lg,
  },
  // Press feedback (P10): a pressed card dips to 0.92 opacity, the
  // same pressed-state language BottomNav/StackHeader already use.
  cardPressed: { opacity: 0.92 },
  thumbnailWrap: { position: 'relative' },
  thumbnail: {
    width: '100%',
    aspectRatio: layout.thumbnailAspectRatio,
    // Light placeholder while the image is in flight (QA issue 7) —
    // this was playerBackground (pure black), so every slow thumbnail
    // read as a black rectangle. Matches the skeleton colour.
    backgroundColor: colors.surfaceVariant,
  },
  thumbnailEmpty: {
    backgroundColor: colors.surfaceVariant,
    alignItems: 'center',
    justifyContent: 'center',
  },
  thumbnailFallbackMark: { width: 56, height: 56, opacity: 0.9 },
  upNextFallbackMark: { width: 30, height: 30, opacity: 0.9 },
  liveBadge: {
    position: 'absolute',
    right: nativeApp.feedCard.badgeInset,
    bottom: nativeApp.feedCard.badgeInset,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: colors.accent,
    // Phase 9 W2 (audit D13): LIVE badge radius is radii.liveBadge (6)
    // everywhere; the round-2 ~8 estimate is superseded by the audit.
    borderRadius: radii.liveBadge,
    paddingHorizontal: 7,
    paddingVertical: 4,
  },
  liveText: { color: '#FFFFFF', fontSize: 13, fontWeight: '700' },
  upcomingBadge: {
    position: 'absolute',
    right: nativeApp.feedCard.badgeInset,
    bottom: nativeApp.feedCard.badgeInset,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: 'rgba(0,0,0,0.8)',
    borderRadius: radii.liveBadge,
    paddingHorizontal: 7,
    paddingVertical: 4,
  },
  durationBadge: {
    position: 'absolute',
    right: nativeApp.feedCard.badgeInset,
    bottom: nativeApp.feedCard.badgeInset,
    backgroundColor: 'rgba(0,0,0,0.8)',
    // Phase 9 W2 (audit D13): duration badge radius is radii.badge (4)
    // everywhere — this previously (mis)used the LIVE badge token.
    borderRadius: radii.badge,
    paddingHorizontal: 6,
    paddingVertical: 3,
  },
  durationText: { color: '#FFFFFF', fontSize: 12, fontWeight: '600' },
  body: {
    backgroundColor: colors.surface,
    paddingHorizontal: nativeApp.feedCard.bodyPadding,
    paddingTop: spacing.md,
    paddingBottom: spacing.md,
  },
  // QA issue 52: reference card titles are ~15-16px, two lines max.
  // Phase 9 W2: values come from the typography.cardTitle token.
  title: { ...typography.cardTitle, color: colors.text },
  row: { flexDirection: 'row', alignItems: 'center', marginTop: 10, gap: spacing.md },
  avatar: { width: 40, height: 40, borderRadius: 20 },
  avatarFallback: {
    backgroundColor: colors.surfaceVariant,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitial: { fontSize: 16, fontWeight: '600', color: colors.textSecondary },
  lines: { flex: 1, minWidth: 0 },
  handle: { ...typography.channelName, color: colors.textSecondary },
  // Phase 9 W2 (audit D6): feed meta uses typography.metadataLg (13px,
  // reference ≈13–14); the 12px metadata token stays for compact rows.
  meta: { ...typography.metadataLg, color: colors.textSecondary, marginTop: 1 },
  engagement: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: nativeApp.feedCard.engagementRow.iconGap,
    flexShrink: 0,
  },
  // Up Next compact row (QA 57): horizontal, flat on the white sheet.
  upNextCard: {
    backgroundColor: colors.surface,
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
    // Light placeholder while loading (was playerBackground black —
    // a slow Up Next row read as a black rectangle; same fix as the
    // feed thumbnail, QA issue 7 pattern).
    backgroundColor: colors.surfaceVariant,
  },
  upNextBadge: {
    position: 'absolute',
    right: 4,
    bottom: 4,
    backgroundColor: 'rgba(0,0,0,0.8)',
    borderRadius: radii.badge,
    paddingHorizontal: 4,
    paddingVertical: 2,
  },
  // LIVE keeps the unified radii.liveBadge (6) even in the compact row.
  upNextLiveBadge: { borderRadius: radii.liveBadge },
  upNextTitle: { fontSize: 15, lineHeight: 20, fontWeight: '600', color: colors.text },
  upNextMeta: { fontSize: 13, lineHeight: 18, color: colors.textSecondary, marginTop: 3 },
  upNextMetaSub: { fontSize: 13, lineHeight: 18, color: colors.textSecondary },
  // Phase 9 W2 (audit D15): the kebab's own box is ≥44×44 — the old
  // 20px glyph + hitSlop 8 gave a ≈36px target, below the minimum.
  moreButton: { marginTop: 1, minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
});
