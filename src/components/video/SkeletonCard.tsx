import React, { memo, useEffect, useMemo, useRef } from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import { layout, nativeApp, radii, spacing, useTheme, type ThemeColors } from '../../theme';

/**
 * Loading placeholder with the EXACT geometry of the real card, so the
 * list does not jump when data arrives (performance requirement).
 * `feed` = full-bleed home card; `shelf` = inset card with side padding
 * supplied by the parent, matching ShelfCard; `row` = the compact
 * VideoListRow geometry (40%-width thumbnail at left, lines at right)
 * used by History / Saved / Playlist lists (QA round 2, issue 16:
 * those screens showed a lone "Loading…" on a huge empty page).
 *
 * Phase 9 W2 (audit §9): the skeleton now PULSES — an RN Animated
 * opacity loop (0.55 ↔ 1, 1100ms per leg, native driver) on the whole
 * skeleton container. Previously every block was a flat static View,
 * which read as a frozen/broken page on slow loads. No new dependency.
 */
export const SkeletonCard = memo(function SkeletonCard({
  variant,
}: {
  variant: 'feed' | 'shelf' | 'row';
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const pulse = useRef(new Animated.Value(0.55)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 1100, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0.55, duration: 1100, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  if (variant === 'row') {
    return (
      <Animated.View style={[styles.rowCard, { opacity: pulse }]}>
        <View style={styles.rowThumb} />
        <View style={styles.rowLines}>
          <View style={[styles.line, { width: '88%' }]} />
          <View style={[styles.lineSm, { width: '45%', marginTop: 7 }]} />
        </View>
      </Animated.View>
    );
  }
  const isFeed = variant === 'feed';
  return (
    <Animated.View style={[isFeed ? styles.feedCard : styles.shelfCard, { opacity: pulse }]}>
      <View style={[styles.thumbnail, isFeed ? styles.thumbnailFeed : styles.thumbnailShelf]} />
      <View style={isFeed ? styles.feedBody : styles.shelfBody}>
        {isFeed ? (
          <>
            <View style={[styles.line, { width: '92%' }]} />
            <View style={[styles.line, { width: '64%', marginTop: 6 }]} />
            <View style={styles.row}>
              <View style={styles.avatar} />
              <View style={{ flex: 1 }}>
                <View style={[styles.lineSm, { width: '45%' }]} />
                <View style={[styles.lineSm, { width: '30%', marginTop: 5 }]} />
              </View>
            </View>
          </>
        ) : (
          <>
            <View style={[styles.line, { width: '88%' }]} />
            <View style={[styles.lineSm, { width: '40%', marginTop: 8 }]} />
          </>
        )}
      </View>
    </Animated.View>
  );
});

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  // Feed skeleton mirrors the real FeedCard container: Phase 9 W2
  // flattened the card (no radii), so the skeleton matches — flat
  // thumbnail, flat white body, 16px of page ground below the card.
  feedCard: { marginBottom: spacing.lg },
  shelfCard: { paddingBottom: spacing.xl },
  thumbnail: {
    width: '100%',
    aspectRatio: layout.thumbnailAspectRatio,
    backgroundColor: colors.surfaceVariant,
  },
  thumbnailFeed: {},
  thumbnailShelf: { borderRadius: radii.card },
  feedBody: {
    backgroundColor: colors.surface,
    paddingHorizontal: nativeApp.feedCard.bodyPadding,
    paddingTop: spacing.md,
    paddingBottom: spacing.md,
  },
  shelfBody: { paddingTop: spacing.md },
  line: { height: 17, borderRadius: 4, backgroundColor: colors.surfaceVariant },
  lineSm: { height: 13, borderRadius: 4, backgroundColor: colors.surfaceVariant },
  row: { flexDirection: 'row', alignItems: 'center', marginTop: 10, gap: spacing.md },
  rowCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    paddingVertical: spacing.sm,
  },
  rowThumb: {
    width: '40%',
    maxWidth: 168,
    aspectRatio: layout.thumbnailAspectRatio,
    borderRadius: radii.card,
    backgroundColor: colors.surfaceVariant,
  },
  rowLines: { flex: 1, paddingTop: 2 },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.surfaceVariant,
  },
});
