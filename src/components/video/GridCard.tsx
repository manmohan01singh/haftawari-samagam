import React, { memo, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { layout, radii, spacing, useTheme, type ThemeColors } from '../../theme';
import { CardActionSheet, type CardMenuAction } from '../common/CardActionSheet';
import { formatDuration } from './VideoCard';
import type { CardVideoData } from './cardData';

interface GridCardProps {
  data: CardVideoData;
  onPress?: () => void;
  menuActions?: CardMenuAction[];
}

/**
 * Compact grid card (round-2 ref-2 Subscriptions geometry, measured
 * from the reference screenshot at 412dp width): the cell is ~187dp
 * wide; thumbnail 16:9 radius 12 with the LIVE/duration pill
 * bottom-right; below it a 2-line 14px semibold title with the ⋯
 * menu at its right, then single 12px grey channel and meta lines.
 * Used by the Subscriptions 2-column grid (and reusable anywhere a
 * compact grid is needed). All data is the shared CardVideoData —
 * real API values only.
 */
export const GridCard = memo(function GridCard({ data, onPress, menuActions }: GridCardProps) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [menuOpen, setMenuOpen] = useState(false);
  const isLive = data.broadcastState === 'live';
  return (
    <View style={styles.cell}>
      <Pressable onPress={onPress} style={styles.card} accessibilityRole="button" accessibilityLabel={data.title}>
        <View style={styles.thumbnailWrap}>
          {data.thumbnailUrl ? (
            <Image
              source={{ uri: data.thumbnailUrl }}
              style={styles.thumbnail}
              contentFit="cover"
              cachePolicy="memory-disk"
              transition={150}
            />
          ) : (
            <View style={[styles.thumbnail, styles.thumbnailEmpty]} />
          )}
          {isLive ? (
            <View style={styles.liveBadge}>
              <MaterialIcons name="sensors" size={12} color="#FFFFFF" />
              <Text style={styles.liveText}>LIVE</Text>
            </View>
          ) : data.durationSeconds != null ? (
            <View style={styles.durationBadge}>
              <Text style={styles.durationText}>{formatDuration(data.durationSeconds)}</Text>
            </View>
          ) : null}
        </View>
        <View style={styles.titleRow}>
          <Text style={styles.title} numberOfLines={2}>
            {data.title}
          </Text>
          {menuActions && menuActions.length > 0 ? (
            <Pressable
              onPress={() => setMenuOpen(true)}
              accessibilityRole="button"
              accessibilityLabel="Video options"
              style={styles.moreButton}
            >
              <MaterialIcons name="more-vert" size={18} color={colors.text} />
            </Pressable>
          ) : null}
        </View>
        <Text style={styles.channel} numberOfLines={1}>
          {data.channelLine}
        </Text>
        {data.metaLine ? (
          <Text style={styles.meta} numberOfLines={1}>
            {data.metaLine}
          </Text>
        ) : null}
      </Pressable>
      {menuActions && menuActions.length > 0 ? (
        <CardActionSheet visible={menuOpen} onClose={() => setMenuOpen(false)} actions={menuActions} />
      ) : null}
    </View>
  );
});

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  cell: { flex: 1 },
  card: { paddingBottom: spacing.xl },
  thumbnailWrap: { position: 'relative' },
  thumbnail: {
    width: '100%',
    aspectRatio: layout.thumbnailAspectRatio,
    borderRadius: radii.card,
    // Phase 9 W2 (audit D14): surfaceVariant placeholder, as FeedCard.
    backgroundColor: colors.surfaceVariant,
  },
  thumbnailEmpty: { backgroundColor: colors.surfaceVariant },
  liveBadge: {
    position: 'absolute',
    right: spacing.sm,
    bottom: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: colors.accent,
    borderRadius: radii.liveBadge,
    paddingHorizontal: 5,
    paddingVertical: 2,
  },
  liveText: { color: '#FFFFFF', fontSize: 11, fontWeight: '700' },
  durationBadge: {
    position: 'absolute',
    right: spacing.sm,
    bottom: spacing.sm,
    backgroundColor: 'rgba(0,0,0,0.8)',
    borderRadius: radii.badge,
    paddingHorizontal: 5,
    paddingVertical: 2,
  },
  durationText: { color: '#FFFFFF', fontSize: 11, fontWeight: '600' },
  titleRow: { flexDirection: 'row', alignItems: 'flex-start', marginTop: spacing.sm },
  title: { flex: 1, fontSize: 14, lineHeight: 19, fontWeight: '600', color: colors.text },
  // Phase 9 W2 (audit D15): ≥44×44 hit box — the old 18px glyph +
  // hitSlop 8 gave ≈34px, the smallest target in the app.
  moreButton: { marginLeft: 2, marginTop: 1, minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  channel: { fontSize: 12, color: colors.textSecondary, marginTop: 2 },
  meta: { fontSize: 12, color: colors.textSecondary, marginTop: 1 },
});
