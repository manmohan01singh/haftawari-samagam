import React, { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import { layout, lightColors, nativeApp, radii, spacing } from '../../theme';

/**
 * Loading placeholder with the EXACT geometry of the real card, so the
 * list does not jump when data arrives (performance requirement).
 * `feed` = full-bleed home card; `shelf` = inset card with side padding
 * supplied by the parent, matching ShelfCard.
 */
export const SkeletonCard = memo(function SkeletonCard({ variant }: { variant: 'feed' | 'shelf' }) {
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
  feedCard: { paddingBottom: spacing.lg },
  shelfCard: { paddingBottom: spacing.xl },
  thumbnail: {
    width: '100%',
    aspectRatio: layout.thumbnailAspectRatio,
    backgroundColor: lightColors.surfaceVariant,
  },
  thumbnailFeed: {},
  thumbnailShelf: { borderRadius: radii.card },
  feedBody: { paddingHorizontal: nativeApp.feedCard.bodyPadding, paddingTop: spacing.md },
  shelfBody: { paddingTop: spacing.md },
  line: { height: 17, borderRadius: 4, backgroundColor: lightColors.surfaceVariant },
  lineSm: { height: 13, borderRadius: 4, backgroundColor: lightColors.surfaceVariant },
  row: { flexDirection: 'row', alignItems: 'center', marginTop: 10, gap: spacing.md },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: lightColors.surfaceVariant,
  },
});
