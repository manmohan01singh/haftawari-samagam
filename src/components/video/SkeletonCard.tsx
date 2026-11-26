import React, { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import { layout, lightColors, nativeApp, radii, spacing } from '../../theme';

/**
 * Loading placeholder with the EXACT geometry of the real card, so the
 * list does not jump when data arrives (performance requirement).
 * `feed` = full-bleed home card; `shelf` = inset card with side padding
 * supplied by the parent, matching ShelfCard; `row` = the compact
 * VideoListRow geometry (40%-width thumbnail at left, lines at right)
 * used by History / Saved / Playlist lists (QA round 2, issue 16:
 * those screens showed a lone "Loading…" on a huge empty page).
 */
export const SkeletonCard = memo(function SkeletonCard({
  variant,
}: {
  variant: 'feed' | 'shelf' | 'row';
}) {
  if (variant === 'row') {
    return (
      <View style={styles.rowCard}>
        <View style={styles.rowThumb} />
        <View style={styles.rowLines}>
          <View style={[styles.line, { width: '88%' }]} />
          <View style={[styles.lineSm, { width: '45%', marginTop: 7 }]} />
        </View>
      </View>
    );
  }
  const isFeed = variant === 'feed';
  return (
    <View style={isFeed ? styles.feedCard : styles.shelfCard}>
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
    </View>
  );
});

const styles = StyleSheet.create({
  // Feed skeleton mirrors the real FeedCard container: white body with
  // 20px rounded bottom corners, 20px of page ground below the card.
  feedCard: { marginBottom: 12 },
  shelfCard: { paddingBottom: spacing.xl },
  thumbnail: {
    width: '100%',
    aspectRatio: layout.thumbnailAspectRatio,
    backgroundColor: lightColors.surfaceVariant,
  },
  thumbnailFeed: { borderTopLeftRadius: 16, borderTopRightRadius: 16 },
  thumbnailShelf: { borderRadius: radii.card },
  feedBody: {
    backgroundColor: lightColors.surface,
    borderBottomLeftRadius: 20,
    borderBottomRightRadius: 20,
    paddingHorizontal: nativeApp.feedCard.bodyPadding,
    paddingTop: spacing.md,
    paddingBottom: spacing.md,
  },
  shelfBody: { paddingTop: spacing.md },
  line: { height: 17, borderRadius: 4, backgroundColor: lightColors.surfaceVariant },
  lineSm: { height: 13, borderRadius: 4, backgroundColor: lightColors.surfaceVariant },
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
    backgroundColor: lightColors.surfaceVariant,
  },
  rowLines: { flex: 1, paddingTop: 2 },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: lightColors.surfaceVariant,
  },
});
