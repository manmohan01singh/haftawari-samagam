import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Image } from 'expo-image';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { EmptyState } from '../../components/common/EmptyState';
import { BottomNav, type BottomNavItem } from '../../components/layout/BottomNav';
import { ShelfCard } from '../../components/video/ShelfCard';
import { SkeletonCard } from '../../components/video/SkeletonCard';
import {
  apiCardData,
  formatDateLine,
  listThumbnailUrl,
  type CardVideoData,
} from '../../components/video/cardData';
import { useAuth } from '../../features/auth';
import { useOfficialChannel } from '../../features/channel';
import {
  createSearchController,
  searchAll,
  type SearchResults,
  type VideoResult,
} from '../../features/search';
import { formatCount } from '../../lib/format';
import {
  OFFICIAL_CHANNEL_HANDLE,
  fetchChannelUploads,
  type YouTubeVideoMetadata,
} from '../../lib/youtube';
import { lightColors, radii, spacing, typography } from '../../theme';
import { goBackOrTab } from '../../navigation/safeBack';
import type { RootStackParamList } from '../../navigation/types';
import { FEED_LIST_PERF, H_LIST_PERF } from '../../lib/listPerf';

type Props = NativeStackScreenProps<RootStackParamList, 'SearchResults'>;

type ResultFilter = 'all' | 'local' | 'youtube' | 'live';

/** Map an engine VideoResult onto the shared card display shape. */
function searchResultCardData(v: VideoResult, channelAvatarUrl: string | null): CardVideoData {
  return {
    key: v.videoRowId ? `sb-${v.videoRowId}` : `yt-${v.youtubeVideoId}`,
    title: v.title,
    thumbnailUrl: listThumbnailUrl(v.youtubeVideoId, v.thumbnailUrl),
    durationSeconds: v.liveBroadcastContent === 'live' ? null : v.durationSeconds,
    broadcastState: v.liveBroadcastContent,
    channelLine: OFFICIAL_CHANNEL_HANDLE,
    metaLine:
      v.liveBroadcastContent === 'live' ? 'Live now' : formatDateLine(v.publishedAt),
    channelAvatarUrl,
  };
}

/**
 * Search results (reference §3 layout).
 *
 * STAGED LOADING (QA 91): stage 1 runs the engine local-only (Supabase
 * catalogue, fuzzy-ranked — no YouTube latency) and renders as soon as
 * it lands; stage 2 runs the full engine (YouTube leg + typo-correction
 * retry) and merges in when it lands. The screen never blank-waits on
 * the slow leg, and a failed/slow YouTube leg leaves stage-1 results on
 * screen. When the engine derived a correction (e.g. "haftawri" →
 * "haftawari") a tappable "Did you mean" line says so.
 */
export function SearchResultsScreen({ route, navigation }: Props) {
  const { query } = route.params;
  const channel = useOfficialChannel();
  const { user, profile } = useAuth();
  const controllerRef = useRef<ReturnType<typeof createSearchController> | null>(null);
  if (controllerRef.current === null) {
    controllerRef.current = createSearchController(300);
  }
  const [result, setResult] = useState<{
    query: string;
    data: SearchResults | null;
    error: string | null;
    remotePending: boolean;
  } | null>(null);
  const [latest, setLatest] = useState<YouTubeVideoMetadata[]>([]);
  const [attempt, setAttempt] = useState(0);
  // Filter + refine draft are keyed by query: when the query changes
  // they read as reset, without a setState-in-effect sync.
  const [filterState, setFilterState] = useState<{ q: string; f: ResultFilter }>({
    q: query,
    f: 'all',
  });
  const filter = filterState.q === query ? filterState.f : 'all';
  const setFilter = (f: ResultFilter) => setFilterState({ q: query, f });
  const [draftState, setDraftState] = useState<{ q: string; text: string }>({
    q: query,
    text: query,
  });
  const draft = draftState.q === query ? draftState.text : query;
  const setDraft = (text: string) => setDraftState({ q: query, text });

  const loading = result?.query !== query;
  const error = result?.query === query ? result.error : null;
  const data = result?.query === query ? result.data : null;
  const remotePending = result?.query === query && result.remotePending;

  useEffect(() => {
    const controller = controllerRef.current;
    if (!controller) return;
    let active = true;

    // Stage 1 — local/fuzzy results first, fast and quota-free.
    searchAll(query, { localOnly: true })
      .then((localData) => {
        if (active) {
          setResult((prev) =>
            prev?.query === query && prev.data && !prev.remotePending
              ? prev // stage 2 already landed; do not regress
              : { query, data: localData, error: null, remotePending: true },
          );
        }
      })
      .catch(() => undefined);

    // Stage 2 — full engine (YouTube leg + correction retry).
    controller
      .search(query)
      .then((fullData) => {
        if (active) setResult({ query, data: fullData, error: null, remotePending: false });
      })
      .catch(() => {
        if (active) {
          setResult((prev) =>
            prev?.query === query && prev.data
              ? { ...prev, remotePending: false } // keep stage-1 results; never blank
              : {
                  query,
                  data: null,
                  error: 'Search could not be completed. Check your connection and try again.',
                  remotePending: false,
                },
          );
        }
      });
    return () => {
      active = false;
    };
  }, [query, attempt]);

  const retry = useCallback(() => {
    setResult(null);
    setAttempt((n) => n + 1);
  }, []);

  useEffect(() => {
    const controller = controllerRef.current;
    return () => controller?.cancel();
  }, []);

  const channelResult = data?.channel ?? null;
  const channelMatches = channelResult != null;
  const youtubeSkipped = data?.youtubeSkipped ?? false;
  const didYouMean = data?.didYouMean ?? null;

  useEffect(() => {
    if (!channelMatches || !channel?.uploadsPlaylistId) return;
    let active = true;
    fetchChannelUploads(channel.uploadsPlaylistId)
      .then((page) => {
        if (active) setLatest(page.videos.slice(0, 10));
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [channelMatches, channel]);

  const allItems = useMemo<VideoResult[]>(() => data?.videos ?? [], [data]);
  const counts = useMemo(
    () => ({
      all: allItems.length,
      local: allItems.filter((v) => v.source === 'local').length,
      youtube: allItems.filter((v) => v.source === 'youtube').length,
      live: allItems.filter((v) => v.liveBroadcastContent === 'live').length,
    }),
    [allItems],
  );
  const items = useMemo(
    () =>
      filter === 'all'
        ? allItems
        : filter === 'live'
          ? allItems.filter((v) => v.liveBroadcastContent === 'live')
          : allItems.filter((v) => v.source === filter),
    [allItems, filter],
  );

  const refine = useCallback(() => {
    const q = draft.trim();
    if (q && q !== query) navigation.setParams({ query: q });
  }, [draft, navigation, query]);

  const goHome = useCallback(() => {
    navigation.navigate('MainTabs', { screen: 'Home' });
  }, [navigation]);

  const renderItem = useCallback(
    ({ item }: { item: VideoResult }) => {
      const cardData = searchResultCardData(item, channel?.avatarUrl ?? null);
      return (
        <ShelfCard
          data={cardData}
          showAvatar={item.liveBroadcastContent === 'live'}
          onPress={() =>
            item.videoRowId
              ? navigation.navigate('Watch', { videoRowId: item.videoRowId })
              : navigation.navigate('Watch', { youtubeVideoId: item.youtubeVideoId })
          }
        />
      );
    },
    [channel, navigation],
  );

  const keyExtractor = useCallback(
    (item: VideoResult) => (item.videoRowId ? `sb-${item.videoRowId}` : `yt-${item.youtubeVideoId}`),
    [],
  );

  const filterChips: { key: ResultFilter; label: string; count: number }[] = [
    { key: 'all', label: 'All', count: counts.all },
    { key: 'local', label: 'In this app', count: counts.local },
    { key: 'youtube', label: 'On the channel', count: counts.youtube },
    { key: 'live', label: 'Live', count: counts.live },
  ];

  const header = (
    <View>
      {didYouMean && didYouMean !== query ? (
        <Pressable
          onPress={() => navigation.setParams({ query: didYouMean })}
          accessibilityRole="button"
          style={styles.didYouMeanRow}
        >
          <Text style={styles.didYouMeanText}>
            Did you mean: <Text style={styles.didYouMeanStrong}>{didYouMean}</Text>
          </Text>
        </Pressable>
      ) : null}
      {remotePending ? (
        <Text style={styles.pendingNote}>Searching the official channel…</Text>
      ) : youtubeSkipped ? (
        <Text style={styles.skippedNote}>
          Showing the published archive only — channel results are unavailable right now.
        </Text>
      ) : null}
      {channelResult ? (
        <>
          <View style={styles.channelBlock}>
            {channelResult.avatarUrl ? (
              <Image source={{ uri: channelResult.avatarUrl }} style={styles.channelAvatar} contentFit="cover" cachePolicy="memory-disk" />
            ) : (
              <View style={[styles.channelAvatar, styles.avatarFallback]}>
                <Text style={styles.avatarInitial}>{channelResult.title.charAt(0)}</Text>
              </View>
            )}
            <View style={styles.channelLines}>
              <Text style={styles.channelName} numberOfLines={2}>
                {channelResult.title}
              </Text>
              {channelResult.handle ? <Text style={styles.channelHandle}>{channelResult.handle}</Text> : null}
              <Text style={styles.channelMeta} numberOfLines={1}>
                {channelResult.subscriberCount != null ? `${formatCount(channelResult.subscriberCount)} subscribers` : ''}
                {channelResult.subscriberCount != null && channelResult.videoCount != null ? '  •  ' : ''}
                {channelResult.videoCount != null ? `${formatCount(channelResult.videoCount)} videos` : ''}
              </Text>
            </View>
          </View>
          {/* Only "View Channel": there is no subscription backend for
              this card, so no Subscribed/Subscribe state is faked. */}
          <Pressable
            style={styles.viewChannelPill}
            onPress={() => navigation.navigate('Channel', { channelId: channelResult.channelId })}
            accessibilityRole="button"
          >
            <Text style={styles.viewChannelText}>View Channel</Text>
          </Pressable>
        </>
      ) : null}
      {latest.length > 0 && channelResult ? (
        <View>
          <Text style={styles.latestHeading}>Latest videos</Text>
          <FlatList
            horizontal
            data={latest}
            keyExtractor={(m) => m.youtubeVideoId}
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.carouselContent}
            {...H_LIST_PERF}
            renderItem={({ item }) => {
              const cardData: CardVideoData = apiCardData(item, channel?.avatarUrl ?? null);
              return (
                <View style={styles.carouselCard}>
                  <ShelfCard
                    data={cardData}
                    showAvatar={item.liveBroadcastContent === 'live'}
                    onPress={() => navigation.navigate('Watch', { youtubeVideoId: item.youtubeVideoId })}
                  />
                </View>
              );
            }}
          />
        </View>
      ) : null}
      {allItems.length > 0 ? (
        <>
          <Text style={styles.resultsHeading}>
            {counts.all} {counts.all === 1 ? 'result' : 'results'}
            {channelResult ? ' · plus the channel above' : ''}
          </Text>
          <View style={styles.chipRow}>
            {filterChips
              .filter((chip) => chip.key === 'all' || chip.count > 0)
              .map((chip) => (
                <Pressable
                  key={chip.key}
                  onPress={() => setFilter(chip.key)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: filter === chip.key }}
                  style={[styles.chip, filter === chip.key && styles.chipSelected]}
                >
                  <Text style={[styles.chipText, filter === chip.key && styles.chipTextSelected]}>
                    {chip.label} ({chip.count})
                  </Text>
                </Pressable>
              ))}
          </View>
        </>
      ) : null}
    </View>
  );

  const navItems: BottomNavItem[] = [
    { key: 'Home', label: 'Home', icon: 'home' },
    { key: 'Subscriptions', label: 'Subscriptions', icon: 'subscriptions' },
    { key: 'Channel', label: 'Official channel', kind: 'create' },
    {
      key: 'Library',
      label: 'You',
      kind: 'avatar',
      avatarInitial:
        profile?.display_name?.charAt(0)?.toUpperCase() ?? user?.email?.charAt(0)?.toUpperCase() ?? '?',
    },
  ];

  return (
    <View style={styles.container}>

      <View style={styles.centered}>
        <View style={styles.bar}>
          <Pressable onPress={() => goBackOrTab(navigation, 'Home')} hitSlop={10} accessibilityLabel="Back">
            <MaterialIcons name="arrow-back" size={24} color={lightColors.text} />
          </Pressable>
          <View style={styles.field}>
            <TextInput
              style={styles.fieldInput}
              value={draft}
              onChangeText={setDraft}
              onSubmitEditing={refine}
              returnKeyType="search"
              enterKeyHint="search"
              autoCorrect={false}
              accessibilityLabel="Search query — edit and press search to refine"
            />
            <Pressable
              onPress={goHome}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Clear search and go to Home"
            >
              <MaterialIcons name="close" size={20} color={lightColors.text} />
            </Pressable>
          </View>
        </View>

        {loading ? (
          <View style={styles.listPad}>
            {/* QA issues 4/9: a labelled searching state — the user
                must be able to tell their tap registered and a search
                is running, not stare at a blank page. */}
            <View style={styles.searchingRow}>
              <ActivityIndicator color={lightColors.text} />
              <Text style={styles.searchingLabel}>Searching for “{query}”…</Text>
            </View>
            <SkeletonCard variant="shelf" />
            <SkeletonCard variant="shelf" />
            <SkeletonCard variant="shelf" />
          </View>
        ) : error ? (
          <View style={styles.emptyWrap}>
            <MaterialIcons name="error-outline" size={40} color={lightColors.accent} />
            <EmptyState title="Search failed" message={error} />
            <Pressable style={styles.actionPill} onPress={retry} accessibilityRole="button">
              <Text style={styles.actionPillText}>Try again</Text>
            </Pressable>
          </View>
        ) : (
          <FlatList
            data={items}
            renderItem={renderItem}
            keyExtractor={keyExtractor}
            ListHeaderComponent={header}
            contentContainerStyle={styles.listPad}
            ListEmptyComponent={
              channelMatches || allItems.length > 0 ? undefined : (
                <View style={styles.emptyWrap}>
                  <MaterialIcons name="search-off" size={40} color={lightColors.textSecondary} />
                  <EmptyState
                    title="No results found"
                    message={`Nothing in the archive or the official channel matches "${query}". Check the spelling, try fewer words, or search for part of the shabad title.`}
                  />
                  <Pressable
                    style={styles.actionPill}
                    onPress={() => navigation.navigate('Search')}
                    accessibilityRole="button"
                  >
                    <Text style={styles.actionPillText}>Edit search</Text>
                  </Pressable>
                  <Pressable style={styles.actionPillOutline} onPress={goHome} accessibilityRole="button">
                    <Text style={styles.actionPillOutlineText}>Go to Home</Text>
                  </Pressable>
                </View>
              )
            }
            {...FEED_LIST_PERF}
          />
        )}
      </View>
      <BottomNav
        items={navItems}
        activeKey=""
        onPress={(key) => {
          if (key === 'Channel') navigation.navigate('Channel', {});
          else if (key === 'Home') goHome();
          else if (key === 'Subscriptions') navigation.navigate('MainTabs', { screen: 'Subscriptions' });
          else navigation.navigate('MainTabs', { screen: 'Library' });
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: lightColors.background },
  centered: { flex: 1, width: '100%', maxWidth: 960, alignSelf: 'center' },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.sm,
  },
  field: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: lightColors.surfaceVariant,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.lg,
    height: 44,
  },

  searchingRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 16 },
  searchingLabel: { fontSize: 15, color: lightColors.textSecondary },
  fieldInput: { flex: 1, fontSize: 16, color: lightColors.text, outlineStyle: 'none' } as object,
  emptyWrap: { alignItems: 'center', gap: spacing.md, paddingTop: spacing.xl },
  actionPill: {
    backgroundColor: lightColors.subscribeBackground,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
  },
  actionPillText: { ...typography.chip, color: lightColors.subscribeText },
  actionPillOutline: {
    borderWidth: 1,
    borderColor: lightColors.border,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
  },
  actionPillOutlineText: { ...typography.chip, color: lightColors.text },
  listPad: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.xl },
  didYouMeanRow: { paddingVertical: spacing.sm },
  didYouMeanText: { ...typography.body, fontSize: 15, color: lightColors.textSecondary },
  didYouMeanStrong: { color: lightColors.text, fontWeight: '600', textDecorationLine: 'underline' },
  pendingNote: { ...typography.metadata, color: lightColors.textSecondary, marginTop: spacing.sm },
  skippedNote: { ...typography.metadata, color: lightColors.textSecondary, marginTop: spacing.sm },
  channelBlock: { flexDirection: 'row', gap: spacing.lg, marginTop: spacing.sm },
  channelAvatar: { width: 88, height: 88, borderRadius: 44 },
  avatarFallback: {
    backgroundColor: lightColors.surfaceVariant,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitial: { fontSize: 30, fontWeight: '600', color: lightColors.textSecondary },
  channelLines: { flex: 1, justifyContent: 'center' },
  channelName: { fontSize: 20, lineHeight: 25, fontWeight: '700', color: lightColors.text },
  channelHandle: { fontSize: 14, color: lightColors.textSecondary, marginTop: 3 },
  channelMeta: { fontSize: 14, color: lightColors.textSecondary, marginTop: 2 },
  viewChannelPill: {
    marginTop: spacing.lg,
    borderWidth: 1,
    borderColor: lightColors.border,
    borderRadius: radii.pill,
    paddingVertical: 11,
    alignItems: 'center',
  },
  viewChannelText: { fontSize: 15, fontWeight: '600', color: lightColors.text },
  latestHeading: { ...typography.sectionTitle, color: lightColors.text, marginTop: spacing.xl, marginBottom: spacing.md },
  carouselContent: { gap: spacing.lg },
  carouselCard: { width: 300 },
  resultsHeading: { ...typography.sectionTitle, color: lightColors.text, marginTop: spacing.xl, marginBottom: spacing.md },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.md },
  chip: {
    backgroundColor: lightColors.surfaceVariant,
    borderRadius: radii.badge + 4,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
  },
  chipSelected: { backgroundColor: lightColors.selectedChipBackground },
  chipText: { ...typography.chip, color: lightColors.text },
  chipTextSelected: { color: lightColors.selectedChipText },
});
