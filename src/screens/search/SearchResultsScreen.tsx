import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { IkOnkarMark } from '../../components/layout/IkOnkarMark';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, TextInput, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
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
import { useChannelFollow, useOfficialChannel } from '../../features/channel';
import { Toast, useToast } from '../../components/common/Toast';
import { shareContent, shareFeedback } from '../../lib/share';
import { OFFICIAL_CHANNEL_ID } from '../../lib/youtube';
import {
  createSearchController,
  degradedBannerText,
  mergeRankedResults,
  searchAll,
  searchYoutubeOnly,
  type SearchResults,
  type VideoResult,
} from '../../features/search';
import { formatCount } from '../../lib/format';
import { OFFICIAL_CHANNEL_HANDLE, type YouTubeVideoMetadata } from '../../lib/youtube';
import { getUploadsCached, uploadsPlaylistIdFor } from '../../features/channels';
import { nativeApp, radii, spacing, typography, useTheme, type ThemeColors } from '../../theme';
import { goBackOrTab } from '../../navigation/safeBack';
import type { RootStackParamList } from '../../navigation/types';
import { FEED_LIST_PERF, H_LIST_PERF } from '../../lib/listPerf';
import { watchShareUrl } from '../../navigation/linking';

type Props = NativeStackScreenProps<RootStackParamList, 'SearchResults'>;

type ResultFilter = 'all' | 'local' | 'youtube' | 'live';

/**
 * Bound for the "Searching the channels…" note (sweep round 4): stage 2
 * fans out over up to 9 SEQUENTIAL channel legs + per-channel fallbacks
 * + a correction pass, each leg carrying its own 10s timeout and a
 * retry — a stalled leg can leave the note on screen for minutes while
 * stage-1 results are already shown. After this long the note clears
 * (stage-1 results stay; stage 2 still merges in when it lands, and
 * its banner then shows from real stage-2 data).
 */
const REMOTE_PENDING_CAP_MS = 15_000;

/** Map an engine VideoResult onto the shared card display shape. */
function searchResultCardData(v: VideoResult, channelAvatarUrl: string | null): CardVideoData {
  return {
    key: v.videoRowId ? `sb-${v.videoRowId}` : `yt-${v.youtubeVideoId}`,
    title: v.title,
    thumbnailUrl: listThumbnailUrl(v.youtubeVideoId, v.thumbnailUrl),
    durationSeconds: v.liveBroadcastContent === 'live' ? null : v.durationSeconds,
    broadcastState: v.liveBroadcastContent,
    channelLine: v.channelTitle ?? OFFICIAL_CHANNEL_HANDLE,
    metaLine:
      v.liveBroadcastContent === 'live' ? 'Live now' : formatDateLine(v.publishedAt),
    channelAvatarUrl,
    youtubeVideoId: v.youtubeVideoId,
    channelId: v.channelId ?? OFFICIAL_CHANNEL_ID,
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
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { query } = route.params;
  const channel = useOfficialChannel();
  const { width: windowWidth } = useWindowDimensions();
  // Ref-3 carousel: card ≈78% of the screen width, next card peeking.
  const carouselCardWidth = Math.round(windowWidth * nativeApp.shelfCard.carouselCardWidthRatio);
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
  // Whether the stage-2 pending note has hit its time bound for this
  // query (see REMOTE_PENDING_CAP_MS). Reset by the search effect on
  // every new query/retry; stage 2 landing clears remotePending itself.
  const [remoteCapped, setRemoteCapped] = useState(false);
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

  const { toast, showToast } = useToast();
  const shareVideo = useCallback(
    (title: string, youtubeVideoId: string) => {
      void shareContent(title, watchShareUrl({ youtubeVideoId })).then((outcome) => {
        const feedback = shareFeedback(outcome);
        if (feedback) showToast(feedback);
      });
    },
    [showToast],
  );
  const loading = result?.query !== query;
  const error = result?.query === query ? result.error : null;
  const data = result?.query === query ? result.data : null;
  const remotePending = result?.query === query && result.remotePending;

  useEffect(() => {
    const controller = controllerRef.current;
    if (!controller) return;
    let active = true;
    setRemoteCapped(false);

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

    // Time bound on the pending note (REMOTE_PENDING_CAP_MS): if stage 2
    // is still running, the note clears and the header falls silent —
    // stage-1 results stay, and stage 2 still merges in when it lands.
    // (Without this, a stalled leg left "Searching the channels…"
    // under already-loaded results indefinitely — sweep round 4.)
    const capTimer = setTimeout(() => {
      if (active) setRemoteCapped(true);
    }, REMOTE_PENDING_CAP_MS);
    return () => {
      active = false;
      clearTimeout(capTimer);
    };
  }, [query, attempt]);

  const retry = useCallback(() => {
    setResult(null);
    setAttempt((n) => n + 1);
  }, []);

  const [legRetrying, setLegRetrying] = useState(false);
  /**
   * Degraded-banner Retry: re-runs ONLY the failed channel leg
   * (search.list + card) and merges what it finds into the results
   * already on screen. The local catalogue is not re-searched and the
   * screen does not reset. On success the banner clears; on a fresh
   * failure the banner's wording updates to the new classified cause.
   */
  const retryLeg = useCallback(() => {
    if (legRetrying) return;
    setLegRetrying(true);
    searchYoutubeOnly(query)
      .then((leg) => {
        setResult((prev) => {
          if (!prev || prev.query !== query || !prev.data) return prev;
          return {
            ...prev,
            data: {
              ...prev.data,
              channel: prev.data.channel ?? leg.channel,
              videos: mergeRankedResults(prev.data.videos, leg.videos),
              youtubeSkipped: leg.youtubeSkipped,
              youtubeError: leg.youtubeError,
              youtubeFallback: leg.youtubeFallback,
            },
          };
        });
      })
      .catch(() => undefined) // a failed retry keeps the banner; its class was logged by the leg
      .finally(() => setLegRetrying(false));
  }, [legRetrying, query]);

  useEffect(() => {
    const controller = controllerRef.current;
    return () => controller?.cancel();
  }, []);

  const channelResult = data?.channel ?? null;
  const channelMatches = channelResult != null;
  // Device-local follow for the channel card's bell pill — the SAME
  // AsyncStorage store the Channel screen uses (useChannelFollow), so
  // both surfaces agree. It is not a YouTube subscription and changes
  // no counts.
  const { following, toggleFollow } = useChannelFollow(channelResult?.channelId ?? OFFICIAL_CHANNEL_ID);
  const youtubeSkipped = data?.youtubeSkipped ?? false;
  const didYouMean = data?.didYouMean ?? null;

  // "Latest videos" under the channel card belongs to the MATCHED
  // channel (any active panel channel since migration 0003), not
  // always the official one.
  const matchedChannelId = channelResult?.channelId ?? null;
  useEffect(() => {
    if (!channelMatches || !matchedChannelId) return;
    let active = true;
    getUploadsCached(matchedChannelId, uploadsPlaylistIdFor(matchedChannelId))
      .then((videos) => {
        if (active) setLatest(videos.slice(0, 10));
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [channelMatches, matchedChannelId]);

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
      const avatar =
        item.channelId && item.channelId === channelResult?.channelId
          ? channelResult.avatarUrl
          : (channel?.avatarUrl ?? null);
      const cardData = searchResultCardData(item, avatar);
      return (
        <ShelfCard
          data={cardData}
          showAvatar={item.liveBroadcastContent === 'live'}
          menuActions={[
            {
              key: 'share',
              label: 'Share',
              icon: 'share',
              // Hosted results have no YouTube id/link; they carry a
              // videoRowId and open in-app, so there is nothing to share.
              onPress: () => {
                if (item.youtubeVideoId) shareVideo(item.title, item.youtubeVideoId);
              },
            },
          ]}
          onPress={() =>
            item.videoRowId
              ? navigation.navigate('Watch', { videoRowId: item.videoRowId })
              : navigation.navigate('Watch', { youtubeVideoId: item.youtubeVideoId ?? undefined })
          }
        />
      );
    },
    [channel, channelResult, navigation, shareVideo],
  );

  const keyExtractor = useCallback(
    (item: VideoResult) => (item.videoRowId ? `sb-${item.videoRowId}` : `yt-${item.youtubeVideoId}`),
    [],
  );

  const filterChips: { key: ResultFilter; label: string; count: number }[] = [
    { key: 'all', label: 'All', count: counts.all },
    { key: 'local', label: 'In this app', count: counts.local },
    { key: 'youtube', label: 'On channels', count: counts.youtube },
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
      {remotePending && !remoteCapped ? (
        <Text style={styles.pendingNote}>Searching the channels…</Text>
      ) : !remotePending && data?.youtubeFallback ? (
        <Text style={styles.pendingNote}>
          Channel search is unavailable — showing matches from the channels&apos; latest uploads.
        </Text>
      ) : !remotePending && youtubeSkipped ? (
        <View style={styles.skippedRow}>
          <Text style={[styles.skippedNote, styles.skippedText]}>
            {degradedBannerText(data?.youtubeError ?? null)}
          </Text>
          <Pressable
            hitSlop={6}
            style={styles.retryChip}
            onPress={retryLeg}
            disabled={legRetrying}
            accessibilityRole="button"
            accessibilityLabel="Retry channel search"
          >
            {legRetrying ? (
              <ActivityIndicator size="small" color={colors.text} />
            ) : (
              <Text style={styles.retryChipText}>Retry</Text>
            )}
          </Pressable>
        </View>
      ) : null}
      {channelResult ? (
        /* Ref-3: the whole channel block — identity row, both pills,
           "Latest videos" + carousel — sits on the pale blue-grey
           tinted surface; regular results continue below on white.
           The tint bleeds to the screen edges (negative margins cancel
           the list's horizontal padding). */
        <View style={styles.tintBlock}>
          <View style={styles.channelBlock}>
            {channelResult.avatarUrl ? (
              <Image source={{ uri: channelResult.avatarUrl }} style={styles.channelAvatar} contentFit="cover" cachePolicy="memory-disk" />
            ) : (
              <View style={[styles.channelAvatar, styles.avatarFallback]}>
                <Text style={styles.avatarInitial}>{channelResult.title.charAt(0)}</Text>
              </View>
            )}
            <View style={styles.channelLines}>
              <View style={styles.channelNameRow}>
                <Text style={styles.channelName} numberOfLines={2}>
                  {channelResult.title}
                </Text>
                {/* The engine's channel result is the official channel
                    singleton (a verified music channel per the API
                    record), so the badge belongs to this record only. */}
                {channelResult.channelId === OFFICIAL_CHANNEL_ID ? (
                  <MaterialIcons name="verified" size={16} color={colors.textSecondary} style={styles.verifiedBadge} />
                ) : null}
              </View>
              {channelResult.handle ? <Text style={styles.channelHandle}>{channelResult.handle}</Text> : null}
              <Text style={styles.channelMeta} numberOfLines={1}>
                {channelResult.subscriberCount != null ? `${formatCount(channelResult.subscriberCount)} subscribers` : ''}
                {channelResult.subscriberCount != null && channelResult.videoCount != null ? '  •  ' : ''}
                {channelResult.videoCount != null ? `${formatCount(channelResult.videoCount)} videos` : ''}
              </Text>
            </View>
          </View>
          {/* Two pills, ≈48% each (ref-3). LEFT: bell pill driven by
              the honest device-local follow store shared with the
              Channel screen — "Subscribe" → "Following"; it is NOT a
              YouTube subscription and changes no counts. RIGHT:
              outlined "View Channel" (real navigation). */}
          <View style={styles.buttonRow}>
            <Pressable
              style={styles.followPill}
              onPress={toggleFollow}
              accessibilityRole="button"
              accessibilityState={{ selected: following }}
              accessibilityLabel={following ? 'Following this channel on this device' : 'Follow this channel on this device'}
            >
              <MaterialIcons
                name={following ? 'notifications' : 'notifications-none'}
                size={20}
                color={colors.text}
              />
              <Text style={styles.followPillText}>{following ? 'Following' : 'Subscribe'}</Text>
              {following ? <MaterialIcons name="expand-more" size={18} color={colors.text} /> : null}
            </Pressable>
            <Pressable
              style={styles.viewChannelPill}
              onPress={() => navigation.navigate('Channel', { channelId: channelResult.channelId })}
              accessibilityRole="button"
            >
              <Text style={styles.viewChannelText}>View Channel</Text>
            </Pressable>
          </View>
          <Text style={styles.followNote}>Follow is saved on this device only</Text>
          {latest.length > 0 ? (
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
                  const cardData: CardVideoData = apiCardData(item, channelResult?.avatarUrl ?? channel?.avatarUrl ?? null);
                  return (
                    <View style={{ width: carouselCardWidth }}>
                      <ShelfCard
                        data={cardData}
                        showAvatar
                        menuActions={[
                          {
                            key: 'share',
                            label: 'Share',
                            icon: 'share',
                            onPress: () => shareVideo(item.title, item.youtubeVideoId),
                          },
                        ]}
                        onPress={() => navigation.navigate('Watch', { youtubeVideoId: item.youtubeVideoId })}
                      />
                    </View>
                  );
                }}
              />
            </View>
          ) : null}
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
                  hitSlop={6}
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
    { key: 'Shorts', label: 'Shorts', kind: 'shorts' },
    { key: 'Subscriptions', label: 'Subscriptions', icon: 'subscriptions' },
    {
      key: 'Library',
      label: 'You',
      kind: 'avatar',
      avatarUrl: profile?.avatar_url ?? null,
      avatarInitial:
        profile?.display_name?.charAt(0)?.toUpperCase() ?? user?.email?.charAt(0)?.toUpperCase() ?? '?',
    },
  ];

  return (
    <View style={styles.container}>

      <View style={styles.centered}>
        <View style={[styles.bar, { paddingTop: spacing.xs + insets.top }]}>
          <Pressable onPress={() => goBackOrTab(navigation, 'Home')} hitSlop={10} accessibilityLabel="Back">
            <MaterialIcons name="arrow-back" size={24} color={colors.text} />
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
              <MaterialIcons name="close" size={20} color={colors.text} />
            </Pressable>
          </View>
        </View>

        {loading ? (
          <View style={styles.listPad}>
            {/* QA issues 4/9: a labelled searching state — the user
                must be able to tell their tap registered and a search
                is running, not stare at a blank page. */}
            <IkOnkarMark label={`Searching for “${query}”…`} />
            <SkeletonCard variant="shelf" />
            <SkeletonCard variant="shelf" />
            <SkeletonCard variant="shelf" />
          </View>
        ) : error ? (
          <View style={styles.emptyWrap}>
            <MaterialIcons name="error-outline" size={40} color={colors.accent} />
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
              channelMatches || allItems.length > 0 ? undefined : remotePending ? (
                // Stage 2 (the channel scan) is still running: NEVER
                // declare "No results found" yet (user screenshot,
                // 28 Nov 2026 — the empty state flashed while the
                // channels were still being searched, then results
                // arrived). Show the searching state instead.
                <View style={styles.emptyWrap}>
                  <IkOnkarMark label="Searching the channels…" />
                </View>
              ) : (
                <View style={styles.emptyWrap}>
                  <MaterialIcons name="search-off" size={40} color={colors.textSecondary} />
                  <EmptyState
                    title="No results found"
                    message={
                      youtubeSkipped
                        ? `Nothing in the published archive matches "${query}", and channel results could not be loaded — see the note above. Tap Retry to try the channel again.`
                        : `Nothing in the archive or the official channel matches "${query}". Check the spelling, try fewer words, or search for part of the shabad title.`
                    }
                  />
                  {youtubeSkipped ? (
                    <Pressable
                      style={styles.actionPill}
                      onPress={retryLeg}
                      disabled={legRetrying}
                      accessibilityRole="button"
                    >
                      <Text style={styles.actionPillText}>{legRetrying ? 'Retrying…' : 'Retry'}</Text>
                    </Pressable>
                  ) : null}
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
          if (key === 'Home') goHome();
          else if (key === 'Shorts') navigation.navigate('MainTabs', { screen: 'Shorts' });
          else if (key === 'Subscriptions') navigation.navigate('MainTabs', { screen: 'Subscriptions' });
          else navigation.navigate('MainTabs', { screen: 'Library' });
        }}
      />
      <Toast message={toast} />
    </View>
  );
}

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  centered: { flex: 1, width: '100%', maxWidth: 960, alignSelf: 'center' },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    minHeight: nativeApp.searchChannel.headerHeight, // 56
    paddingVertical: spacing.xs,
  },
  field: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surfaceVariant,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.lg,
    height: nativeApp.searchChannel.pillHeight, // 48
  },

  searchingRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 16 },
  searchingLabel: { fontSize: 15, color: colors.textSecondary },
  fieldInput: { flex: 1, fontSize: 16, color: colors.text, outlineStyle: 'none' } as object,
  emptyWrap: { alignItems: 'center', gap: spacing.md, paddingTop: spacing.xl },
  actionPill: {
    backgroundColor: colors.subscribeBackground,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
  },
  actionPillText: { ...typography.chip, color: colors.subscribeText },
  actionPillOutline: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
  },
  actionPillOutlineText: { ...typography.chip, color: colors.text },
  listPad: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.xl },
  didYouMeanRow: { paddingVertical: spacing.sm },
  didYouMeanText: { ...typography.body, fontSize: 15, color: colors.textSecondary },
  didYouMeanStrong: { color: colors.text, fontWeight: '600', textDecorationLine: 'underline' },
  pendingNote: { ...typography.metadata, color: colors.textSecondary, marginTop: spacing.sm },
  skippedNote: { ...typography.metadata, color: colors.textSecondary, marginTop: spacing.sm },
  skippedRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginTop: spacing.sm },
  skippedText: { flex: 1, marginTop: 0 },
  retryChip: {
    backgroundColor: colors.surfaceVariant,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.lg,
    paddingVertical: 6,
    minWidth: 72,
    alignItems: 'center',
  },
  retryChipText: { ...typography.chip, color: colors.text },
  tintBlock: {
    backgroundColor: colors.searchTint,
    // Bleed to the screen edges: cancel the list's horizontal padding.
    marginHorizontal: -spacing.lg,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.lg,
    marginTop: spacing.sm,
  },
  channelBlock: { flexDirection: 'row', gap: spacing.lg },
  channelAvatar: {
    width: nativeApp.searchChannel.avatarSize,
    height: nativeApp.searchChannel.avatarSize,
    borderRadius: nativeApp.searchChannel.avatarSize / 2,
  },
  channelNameRow: { flexDirection: 'row', alignItems: 'flex-start' },
  verifiedBadge: { marginLeft: spacing.xs, marginTop: 5, flexShrink: 0 },
  avatarFallback: {
    backgroundColor: colors.surfaceVariant,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitial: { fontSize: 30, fontWeight: '600', color: colors.textSecondary },
  channelLines: { flex: 1, justifyContent: 'center' },
  channelName: {
    fontSize: nativeApp.searchChannel.nameFontSize,
    lineHeight: 25,
    fontWeight: '700',
    color: colors.text,
    flexShrink: 1,
  },
  buttonRow: {
    flexDirection: 'row',
    gap: nativeApp.searchChannel.buttonGap,
    marginTop: spacing.lg,
  },
  followPill: {
    flex: 1,
    height: nativeApp.searchChannel.buttonHeight, // 44
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surfaceVariant,
    borderRadius: radii.pill,
  },
  followPillText: { fontSize: 15, fontWeight: '600', color: colors.text },
  followNote: { ...typography.metadata, color: colors.textSecondary, marginTop: 6 },
  channelHandle: { fontSize: 14, color: colors.textSecondary, marginTop: 3 },
  channelMeta: { fontSize: 14, color: colors.textSecondary, marginTop: 2 },
  viewChannelPill: {
    flex: 1,
    height: nativeApp.searchChannel.buttonHeight, // 44
    borderWidth: 1,
    borderColor: colors.border, // ref-3: clearly visible outline on the tint
    borderRadius: radii.pill,
    justifyContent: 'center',
    alignItems: 'center',
  },
  viewChannelText: { fontSize: 15, fontWeight: '600', color: colors.text },
  latestHeading: { ...typography.sectionTitle, color: colors.text, marginTop: spacing.xl, marginBottom: spacing.md },
  carouselContent: { gap: spacing.lg },
  resultsHeading: { ...typography.sectionTitle, color: colors.text, marginTop: spacing.xl, marginBottom: spacing.md },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.md },
  chip: {
    backgroundColor: colors.surfaceVariant,
    borderRadius: radii.chipRadius,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
  },
  chipSelected: { backgroundColor: colors.selectedChipBackground },
  chipText: { ...typography.chip, color: colors.text },
  chipTextSelected: { color: colors.selectedChipText },
});
