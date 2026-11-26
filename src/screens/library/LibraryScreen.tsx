import React, { useCallback, useEffect, useState } from 'react';
import {
  Dimensions,
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Image } from 'expo-image';
import { MaterialIcons } from '@expo/vector-icons';
import type { CompositeScreenProps } from '@react-navigation/native';
import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { listThumbnailUrl } from '../../components/video/cardData';
import { useAuth } from '../../features/auth';
import { useOfficialChannel } from '../../features/channel';
import { fetchSavedVideos, fetchWatchHistory, type HistoryItem } from '../../lib/videos';
import { isSupabaseConfigured } from '../../lib/supabase';
import { layout, lightColors, nativeApp, radii, spacing } from '../../theme';
import type { Video } from '../../types/database';
import type { MainTabParamList, RootStackParamList } from '../../navigation/types';

type Props = CompositeScreenProps<
  BottomTabScreenProps<MainTabParamList, 'Library'>,
  NativeStackScreenProps<RootStackParamList>
>;

const HISTORY_CARD_WIDTH = Math.round(Dimensions.get('window').width * 0.36);

/**
 * "You" / Library page (reference §4 geometry): Accounts pill header,
 * profile block, History shelf, and Library stacked rows. All content
 * is the signed-in user's REAL data (watch_history + saved_videos);
 * signed-out visitors get an honest sign-in prompt, never fake rows.
 * (Downloads/Liked playlists from the reference do not exist in this
 * app's data model and are not imitated.)
 */
export function LibraryScreen({ navigation }: Props) {
  const { user, profile } = useAuth();
  const channel = useOfficialChannel();
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [saved, setSaved] = useState<Video[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!user || !isSupabaseConfigured) {
      // Mark loaded via a timer callback (not synchronously in the effect).
      const t = setTimeout(() => setLoaded(true), 0);
      return () => clearTimeout(t);
    }
    let active = true;
    Promise.all([
      fetchWatchHistory(user.id, 10).catch(() => []),
      fetchSavedVideos(user.id).catch(() => []),
    ]).then(([h, s]) => {
      if (!active) return;
      setHistory(h);
      setSaved(s);
      setLoaded(true);
    });
    return () => {
      active = false;
    };
  }, [user]);

  const renderHistoryCard = useCallback(
    ({ item }: { item: HistoryItem }) => (
      <Pressable
        style={styles.historyCard}
        onPress={() => navigation.navigate('Watch', { videoRowId: item.video.id })}
        accessibilityRole="button"
      >
        <Image
          source={{ uri: listThumbnailUrl(item.video.youtube_video_id, item.video.thumbnail_url) ?? undefined }}
          style={styles.historyThumb}
          contentFit="cover"
          cachePolicy="memory-disk"
        />
        <Text style={styles.historyTitle} numberOfLines={2}>
          {item.video.title}
        </Text>
        <Text style={styles.historyChannel} numberOfLines={1}>
          {channel?.title ?? ''}
        </Text>
      </Pressable>
    ),
    [channel, navigation],
  );

  const displayName = profile?.display_name ?? user?.email ?? null;
  const initial = displayName?.charAt(0)?.toUpperCase() ?? null;

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <Pressable
          style={styles.accountsPill}
          onPress={() => navigation.navigate('Account')}
          accessibilityRole="button"
        >
          <Text style={styles.accountsText}>Accounts</Text>
          <MaterialIcons name="keyboard-arrow-down" size={20} color={lightColors.text} />
        </Pressable>
        <View style={styles.headerActions}>
          <Pressable onPress={() => navigation.navigate('Search')} hitSlop={8} accessibilityLabel="Search">
            <MaterialIcons name="search" size={24} color={lightColors.text} />
          </Pressable>
          <Pressable onPress={() => navigation.navigate('Settings')} hitSlop={8} accessibilityLabel="Settings">
            <MaterialIcons name="settings" size={24} color={lightColors.text} />
          </Pressable>
        </View>
      </View>

      <ScrollView>
        {user ? (
          <View style={styles.profileBlock}>
            <View style={[styles.profileAvatar, styles.avatarFallback]}>
              <Text style={styles.profileInitial}>{initial}</Text>
            </View>
            <View style={styles.profileLines}>
              <Text style={styles.profileName} numberOfLines={1}>
                {profile?.display_name ?? 'Sangat member'}
              </Text>
              <Text style={styles.profileMeta} numberOfLines={1}>
                {user.email}
              </Text>
            </View>
          </View>
        ) : (
          <View style={styles.signInBlock}>
            <Text style={styles.signInTitle}>Sign in to see your library</Text>
            <Text style={styles.signInText}>
              Your history and saved samagams are kept with your account.
            </Text>
            <Pressable
              style={styles.signInButton}
              onPress={() => navigation.navigate('SignIn')}
              accessibilityRole="button"
            >
              <Text style={styles.signInButtonText}>Sign in</Text>
            </Pressable>
          </View>
        )}

        <Pressable
          style={styles.sectionHeadingRow}
          onPress={() => navigation.navigate('History')}
          accessibilityRole="button"
        >
          <Text style={styles.sectionHeading}>History</Text>
          <MaterialIcons name="chevron-right" size={22} color={lightColors.text} />
        </Pressable>
        {user && history.length > 0 ? (
          <FlatList
            horizontal
            data={history}
            keyExtractor={(item) => `${item.entry.video_id}-${item.entry.watched_at}`}
            renderItem={renderHistoryCard}
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.historyContent}
          />
        ) : (
          <Text style={styles.emptyLine}>
            {user ? 'Recordings you watch will appear here.' : 'Sign in to build your history.'}
          </Text>
        )}

        <Text style={[styles.sectionHeading, styles.libraryHeading]}>Library</Text>
        {user && saved.length > 0 ? (
          saved.map((video) => (
            <Pressable
              key={video.id}
              style={styles.stackRow}
              onPress={() => navigation.navigate('Watch', { videoRowId: video.id })}
              accessibilityRole="button"
            >
              <View style={styles.stackThumbWrap}>
                <View style={styles.stackEdge} />
                <Image
                  source={{ uri: listThumbnailUrl(video.youtube_video_id, video.thumbnail_url) ?? undefined }}
                  style={styles.stackThumb}
                  contentFit="cover"
                  cachePolicy="memory-disk"
                />
              </View>
              <View style={styles.stackLines}>
                <Text style={styles.stackTitle} numberOfLines={2}>
                  {video.title}
                </Text>
                <Text style={styles.stackMeta}>Saved</Text>
              </View>
              <MaterialIcons name="more-horiz" size={22} color={lightColors.text} />
            </Pressable>
          ))
        ) : (
          <Text style={styles.emptyLine}>
            {loaded
              ? user
                ? 'Samagams you save will appear here.'
                : 'Sign in to save samagams here.'
              : 'Loading…'}
          </Text>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: lightColors.background },
  headerRow: {
    height: layout.headerHeight,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
  },
  accountsPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    backgroundColor: lightColors.surfaceVariant,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.lg,
    paddingVertical: 9,
  },
  accountsText: { fontSize: 15, fontWeight: '500', color: lightColors.text },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 22 },
  profileBlock: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
  },
  profileAvatar: { width: 72, height: 72, borderRadius: 36 },
  avatarFallback: {
    backgroundColor: lightColors.surfaceVariant,
    alignItems: 'center',
    justifyContent: 'center',
  },
  profileInitial: { fontSize: 28, fontWeight: '600', color: lightColors.textSecondary },
  profileLines: { flex: 1 },
  profileName: { fontSize: 24, fontWeight: '700', color: lightColors.text },
  profileMeta: { fontSize: 14, color: lightColors.textSecondary, marginTop: 3 },
  signInBlock: { paddingHorizontal: spacing.lg, paddingTop: spacing.md },
  signInTitle: { fontSize: 20, fontWeight: '600', color: lightColors.text },
  signInText: { fontSize: 14, color: lightColors.textSecondary, marginTop: spacing.xs },
  signInButton: {
    alignSelf: 'flex-start',
    backgroundColor: lightColors.subscribeBackground,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.xl,
    paddingVertical: 11,
    marginTop: spacing.md,
  },
  signInButtonText: { fontSize: 15, fontWeight: '600', color: lightColors.subscribeText },
  sectionHeadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    marginTop: spacing.xxl,
  },
  sectionHeading: { fontSize: 20, fontWeight: '600', color: lightColors.text },
  libraryHeading: { paddingHorizontal: spacing.lg, marginTop: spacing.xxl, marginBottom: spacing.md },
  historyContent: { paddingHorizontal: spacing.lg, gap: spacing.md, paddingTop: spacing.md },
  historyCard: { width: HISTORY_CARD_WIDTH },
  historyThumb: {
    width: '100%',
    aspectRatio: layout.thumbnailAspectRatio,
    borderRadius: radii.card,
    backgroundColor: lightColors.surfaceVariant,
  },
  historyTitle: { fontSize: 14, lineHeight: 19, fontWeight: '600', color: lightColors.text, marginTop: spacing.sm },
  historyChannel: { fontSize: 13, color: lightColors.textSecondary, marginTop: 2 },
  emptyLine: {
    fontSize: 14,
    color: lightColors.textSecondary,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
  },
  stackRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  stackThumbWrap: { width: '40%', position: 'relative', paddingTop: nativeApp.stackedPlaylist.stackOffset },
  stackEdge: {
    position: 'absolute',
    top: 0,
    left: 6,
    right: 6,
    height: 10,
    borderTopLeftRadius: radii.card,
    borderTopRightRadius: radii.card,
    backgroundColor: lightColors.border,
  },
  stackThumb: {
    width: '100%',
    aspectRatio: layout.thumbnailAspectRatio,
    borderRadius: radii.card,
    backgroundColor: lightColors.surfaceVariant,
  },
  stackLines: { flex: 1 },
  stackTitle: { fontSize: 17, fontWeight: '500', color: lightColors.text },
  stackMeta: { fontSize: 13, color: lightColors.textSecondary, marginTop: 3 },
});
