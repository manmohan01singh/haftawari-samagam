import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  FlatList,
  Linking,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { EmptyState } from '../../components/common/EmptyState';
import { goBackOrTab } from '../../navigation/safeBack';
import { StackTabBar } from '../../components/layout/StackTabBar';
import { StackHeader } from '../../components/layout/StackHeader';
import { LinkedText } from '../../components/common/LinkedText';
import { Toast, useToast } from '../../components/common/Toast';
import { shareContent, shareFeedback } from '../../lib/share';
import { ShelfCard } from '../../components/video/ShelfCard';
import { SkeletonCard } from '../../components/video/SkeletonCard';
import { useWebPullToRefresh } from '../../components/gesture/WebPullToRefresh';
import { ensureDefaultFollowsSeeded, useChannelFollow, useOfficialChannel } from '../../features/channel';
import { formatCount } from '../../lib/format';
import {
  OFFICIAL_CHANNEL_ID,
  fetchChannelById,
  fetchChannelLiveAndUpcoming,
  isShortVideo,
  type YouTubeChannelInfo,
  type YouTubeVideoMetadata,
} from '../../lib/youtube';
import { getUploadsPageCached } from '../../features/channels/channelCache';
import { apiCardData as baseApiCardData, formatDateLine } from '../../components/video/cardData';
import { layout, nativeApp, radii, spacing, typography, useTheme, type ThemeColors } from '../../theme';
import type { RootStackParamList } from '../../navigation/types';
import { FEED_LIST_PERF } from '../../lib/listPerf';
import { channelShareUrl, watchShareUrl } from '../../navigation/linking';

type Props = NativeStackScreenProps<RootStackParamList, 'Channel'>;

type ChannelTab = 'videos' | 'live' | 'about';

/** Channel country code → display name ("IN" → "India") for the
    About tab. Intl.DisplayNames is guarded: older runtimes fall
    back to the raw code rather than crashing the tab. */
function countryName(code: string): string {
  try {
    return new Intl.DisplayNames(['en'], { type: 'region' }).of(code) ?? code;
  } catch {
    return code;
  }
}

/** Module-level cache for the search-based live lookup (100 quota
 *  units per call): one call per channel per 10 minutes is enough for
 *  a Live tab, and it stops every screen mount from re-burning quota. */
const LIVE_CACHE_TTL_MS = 10 * 60 * 1000;
const liveSearchCache = new Map<string, { at: number; items: YouTubeVideoMetadata[] }>();

/**
 * Channel screen — all data live from the YouTube Data API: banner,
 * avatar, name, handle, subscriber/video counts, description, and the
 * uploads list (paginated). Tabs are Videos, Live and About — there is
 * no Shorts tab (user decision, 26 Nov 2026, overriding the reference).
 * The Live tab lists the channel's own broadcasts that YouTube itself
 * reports as live now or upcoming; it is not a Samagam session label.
 * The About tab shows the channel's own description, counts, joined
 * date and location — all from the same channels.list response, so it
 * costs no extra quota; joined date / location are absent from cache
 * entries saved before they were added, and are simply omitted then.
 */
export function ChannelScreen({ route, navigation }: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const insets = useSafeAreaInsets();
  const channelId = route.params.channelId ?? OFFICIAL_CHANNEL_ID;
  const isOfficial = channelId === OFFICIAL_CHANNEL_ID;
  const official = useOfficialChannel();
  const [fetchedChannel, setFetchedChannel] = useState<YouTubeChannelInfo | null>(null);
  // The official channel's data comes from the shared cached hook; any
  // other channel is fetched by id into fetchedChannel.
  const channel = fetchedChannel ?? (isOfficial ? official : null);
  const [tab, setTab] = useState<ChannelTab>(route.params.tab ?? 'videos');
  const [menuOpen, setMenuOpen] = useState(false);
  const { width } = useWindowDimensions();
  const columns = width >= 1024 ? 3 : width >= 640 ? 2 : 1;
  const [uploads, setUploads] = useState<YouTubeVideoMetadata[]>([]);
  const [nextPage, setNextPage] = useState<string | null>(null);
  const [liveItems, setLiveItems] = useState<YouTubeVideoMetadata[]>([]);
  const [loading, setLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [liveLoaded, setLiveLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [descExpanded, setDescExpanded] = useState(false);
  // QA33: there is NO subscriptions backend table, so Subscribe here is
  // an honest DEVICE-LOCAL follow, via the SAME shared hook (and the
  // same AsyncStorage key) the Search channel block uses, so both
  // surfaces always agree. It drives nothing fake — no counts change,
  // and it is labelled as device-local under the pill row.
  const { following, toggleFollow, reload: reloadFollow } = useChannelFollow(channelId);
  // Phase 11: the app's own channels are followed by default. Seed
  // that (one-time per channel; only fills an absent follow key, so
  // an earlier unfollow is never overridden) here as well, so a
  // first-ever visit to a registry channel already shows
  // "Subscribed" instead of depending on the Subscriptions tab
  // having been opened once. Reload afterwards to pick up the seed.
  useEffect(() => {
    void ensureDefaultFollowsSeeded().then(() => reloadFollow());
  }, [reloadFollow]);
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

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const info = isOfficial && official ? official : await fetchChannelById(channelId);
        if (!active) return;
        if (!info) throw new Error('Channel not found.');
        setFetchedChannel(info);
        if (info.uploadsPlaylistId) {
          const page = await getUploadsPageCached(info.uploadsPlaylistId);
          if (!active) return;
          setUploads(page.videos);
          setNextPage(page.nextPageToken);
        }
      } catch (e) {
        if (active) setError(e instanceof Error ? e.message : 'Could not load this channel.');
      } finally {
        if (active) { setLoading(false); setRefreshing(false); }
      }
    })();
    return () => {
      active = false;
    };
  }, [channelId, isOfficial, official, reloadKey]);

  // Pull-to-refresh (audit A1): web gesture via the shared hook
  // (RefreshControl is a PWA stub); a pull re-runs the load effect.
  const onRefresh = useCallback(() => {
    setRefreshing(true);
    setLoading(true);
    setReloadKey((k) => k + 1);
  }, []);
  const ptr = useWebPullToRefresh({ onRefresh, refreshing });

  // Live discovery (round-3 senior fix, found live 27 Nov): the old
  // code swallowed the search call's failure and then stated "not
  // live right now" — while the channel WAS live (a 24/7 stream).
  // search.list costs 100 quota units and the project's daily search
  // quota was exhausted (HTTP 429 verified), so the failure was
  // routine, not rare. Rules now:
  //  1. Uploads metadata is the zero-cost first source: videos.list
  //     already resolved every uploads item's liveBroadcastContent,
  //     so a live/upcoming item in the uploads pages shows with NO
  //     extra call (merged into the Live tab below).
  //  2. The search leg runs once per channel per 10 minutes (module
  //     cache) — it is the only way to find long-running streams that
  //     sit deep in the uploads playlist.
  //  3. A failed search leg is an ERROR state with Retry, never a
  //     false "not live" claim.
  const [liveError, setLiveError] = useState(false);
  const [liveNonce, setLiveNonce] = useState(0);
  useEffect(() => {
    if (tab !== 'live' || liveLoaded) return;
    let active = true;
    const cached = liveSearchCache.get(channelId);
    if (cached && Date.now() - cached.at < LIVE_CACHE_TTL_MS) {
      // Resolve through a promise so state updates land in a
      // callback, not synchronously in the effect body.
      void Promise.resolve(cached.items).then((items) => {
        if (active) {
          setLiveItems(items);
          setLiveLoaded(true);
        }
      });
      return () => {
        active = false;
      };
    }
    fetchChannelLiveAndUpcoming(channelId)
      .then((items) => {
        liveSearchCache.set(channelId, { at: Date.now(), items });
        if (active) {
          setLiveItems(items);
          setLiveError(false);
          setLiveLoaded(true);
        }
      })
      .catch(() => {
        if (active) {
          setLiveError(true);
          setLiveLoaded(true);
        }
      });
    return () => {
      active = false;
    };
  }, [tab, liveLoaded, channelId, liveNonce]);

  const retryLive = useCallback(() => {
    liveSearchCache.delete(channelId);
    setLiveError(false);
    setLiveLoaded(false);
    setLiveNonce((n) => n + 1);
  }, [channelId]);

  const loadMore = useCallback(() => {
    if (!channel?.uploadsPlaylistId || !nextPage || loadingMore) return;
    setLoadingMore(true);
    getUploadsPageCached(channel.uploadsPlaylistId, nextPage)
      .then((page) => {
        setUploads((prev) => [...prev, ...page.videos]);
        setNextPage(page.nextPageToken);
      })
      .catch(() => undefined)
      .finally(() => setLoadingMore(false));
  }, [channel, nextPage, loadingMore]);

  const renderVideo = useCallback(
    ({ item }: { item: YouTubeVideoMetadata }) => {
      const base = baseApiCardData(item, channel?.avatarUrl ?? null);
      const data = {
        ...base,
        channelLine: base.channelLine || (channel?.title ?? ''),
        metaLine: base.metaLine || formatDateLine(item.publishedAt),
      };
      return (
        <View style={columns > 1 ? styles.gridCell : undefined}>
          <ShelfCard
            data={data}
            onPress={() => navigation.navigate('Watch', { youtubeVideoId: item.youtubeVideoId })}
            menuActions={[
              {
                key: 'share',
                label: 'Share',
                icon: 'share',
                onPress: () => shareVideo(item.title, item.youtubeVideoId),
              },
            ]}
          />
        </View>
      );
    },
    [channel, navigation, columns, shareVideo, styles],
  );

  const keyExtractor = useCallback((item: YouTubeVideoMetadata) => item.youtubeVideoId, []);

  // Merged live/upcoming: uploads-derived items (zero extra quota —
  // their metadata already carries liveBroadcastContent) UNION the
  // search leg's items, search winning per-id (fresher viewer counts).
  const mergedLive = (() => {
    const byId = new Map<string, YouTubeVideoMetadata>();
    for (const v of uploads) {
      if (v.liveBroadcastContent === 'live' || v.liveBroadcastContent === 'upcoming') {
        byId.set(v.youtubeVideoId, v);
      }
    }
    for (const v of liveItems) byId.set(v.youtubeVideoId, v);
    return [...byId.values()];
  })();
  const liveNow = mergedLive.find((v) => v.liveBroadcastContent === 'live') ?? null;

  const header = channel ? (
    <View>
      <View style={styles.topBarBleed}>
        <StackHeader
          title={channel.title}
          onBack={() => goBackOrTab(navigation, 'Home')}
          right={
            <>
              <Pressable onPress={() => navigation.navigate('Search')} hitSlop={10} accessibilityLabel="Search">
                <MaterialIcons name="search" size={24} color={colors.text} />
              </Pressable>
              <Pressable onPress={() => setMenuOpen(true)} hitSlop={10} accessibilityLabel="Channel options">
                <MaterialIcons name="more-vert" size={24} color={colors.text} />
              </Pressable>
            </>
          }
        />
      </View>
      {channel.bannerUrl ? (
        <Image
          source={{ uri: channel.bannerUrl }}
          style={styles.banner}
          contentFit="cover"
          cachePolicy="memory-disk"
        />
      ) : null}
      <View style={styles.identity}>
        {/* Real-YouTube parity (Part B, 27 Nov): when the channel is
            genuinely live, its avatar carries a red ring + a LIVE pill
            overlapping the bottom edge, and tapping it opens the live
            video. Driven ONLY by API-reported live items (liveNow) —
            no ring is ever shown on a guess. */}
        <Pressable
          onPress={liveNow ? () => navigation.navigate('Watch', { youtubeVideoId: liveNow.youtubeVideoId }) : undefined}
          disabled={!liveNow}
          accessibilityRole={liveNow ? 'button' : undefined}
          accessibilityLabel={liveNow ? `Watch live: ${liveNow.title}` : undefined}
        >
          <View style={styles.avatarWrap}>
            {/* Round clip wrapper (see SubscriptionsScreen rail): the
                image's own borderRadius does not reliably clip on
                Android; the live ring lives on this wrapper. */}
            <View style={[styles.avatarClip, liveNow && styles.avatarLiveRing]}>
              {channel.avatarUrl ? (
                <Image
                  source={{ uri: channel.avatarUrl }}
                  style={styles.avatar}
                  contentFit="cover"
                  cachePolicy="memory-disk"
                />
              ) : (
                <View style={[styles.avatar, styles.avatarFallback]}>
                  <Text style={styles.avatarInitial}>{channel.title.charAt(0)}</Text>
                </View>
              )}
            </View>
            {liveNow ? (
              <View style={styles.avatarLivePill} pointerEvents="none">
                <Text style={styles.avatarLiveText}>LIVE</Text>
              </View>
            ) : null}
          </View>
        </Pressable>
        <View style={styles.identityLines}>
          <View style={styles.nameRow}>
            <Text style={styles.name} numberOfLines={2}>{channel.title}</Text>
            {/* Same rule as the Search channel block: the badge belongs
                to the official channel's verified-music record only. */}
            {isOfficial ? (
              <MaterialIcons name="verified" size={16} color={colors.textSecondary} style={styles.verifiedBadge} />
            ) : null}
          </View>
          {channel.handle ? <Text style={styles.handleLine}>{channel.handle}</Text> : null}
          {/* Rendered only when at least one count exists (audit
              A10): with both missing (e.g. a quota outage) it used to
              leave a stray blank line in the identity block. */}
          {channel.subscriberCount != null || channel.videoCount != null ? (
            <Text style={styles.metaLine} numberOfLines={1}>
              {[
                channel.subscriberCount != null ? `${formatCount(channel.subscriberCount)} subscribers` : null,
                channel.videoCount != null ? `${formatCount(channel.videoCount)} videos` : null,
              ]
                .filter(Boolean)
                .join('  •  ')}
            </Text>
          ) : null}
        </View>
      </View>
      {/* Round-3 mobile evidence (m.youtube channel page measured at
          ~412px on the user's phone browser, 27 Nov): the dedicated
          channel page carries ONE near-full-width Subscribe pill
          (~91% of width, ~41px tall) — the two-pill row belongs to
          the Search channel BLOCK (ref-3), not to this page. So this
          screen now matches the channel page itself: a single
          full-width honest device-local follow pill (dark "Subscribe"
          → grey "Subscribed" with bell + chevron). "Open in YouTube"
          remains available in the ⋮ menu above — no action is lost. */}
      <View style={styles.identityActions}>
        <Pressable
          style={[styles.subscribePill, following && styles.subscribePillActive]}
          onPress={toggleFollow}
          accessibilityRole="button"
          accessibilityState={{ selected: following }}
          accessibilityLabel={following ? 'Subscribed on this device' : 'Subscribe on this device'}
        >
          {following ? (
            <>
              <MaterialIcons name="notifications" size={20} color={colors.text} />
              <Text style={[styles.subscribeText, styles.subscribeTextActive]}>Subscribed</Text>
              <MaterialIcons name="expand-more" size={18} color={colors.text} />
            </>
          ) : (
            <Text style={styles.subscribeText}>Subscribe</Text>
          )}
        </Pressable>
      </View>
      <Text style={styles.followNote}>Follow is saved on this device only</Text>
        {channel.description ? (
          <View style={styles.descriptionWrap}>
            <LinkedText
              text={channel.description}
              style={styles.description}
              numberOfLines={descExpanded ? undefined : 3}
            />
            {channel.description.length > 180 ? (
              <Pressable
                onPress={() => setDescExpanded((v) => !v)}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                accessibilityRole="button"
                accessibilityLabel={descExpanded ? 'Show less' : 'Show more'}
              >
                <Text style={styles.moreText}>{descExpanded ? 'Show less' : '…more'}</Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}
      <View style={styles.tabs}>
        {(
          [
            { key: 'videos', label: 'VIDEOS' },
            { key: 'live', label: 'LIVE' },
            { key: 'about', label: 'ABOUT' },
          ] as { key: ChannelTab; label: string }[]
        ).map((t) => {
          const active = tab === t.key;
          return (
            <Pressable
              key={t.key}
              style={[styles.tab, active && styles.tabActive]}
              onPress={() => setTab(t.key)}
              hitSlop={{ top: 8, bottom: 8, left: 6, right: 6 }}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
            >
              <Text style={[styles.tabLabel, active && styles.tabLabelActive]}>{t.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  ) : null;

  if (loading && !channel) {
    return (
      <View style={styles.container}>
        <StackHeader onBack={() => goBackOrTab(navigation, 'Home')} />
        <View style={styles.listPad}>
          {/* Header-shaped skeleton (banner strip at the served crop's
              aspect, 88dp avatar, name/handle/count lines, pill row) —
              the screen never shows a grey blank or a lone spinner
              while the channel loads. */}
          <View style={styles.skelBanner} />
          <View style={styles.skelIdentity}>
            <View style={styles.skelAvatar} />
            <View style={styles.skelLines}>
              <View style={[styles.skelBar, { width: '85%' }]} />
              <View style={[styles.skelBar, { width: '55%' }]} />
              <View style={[styles.skelBar, { width: '70%' }]} />
            </View>
          </View>
          <View style={styles.skelPills}>
            <View style={styles.skelPill} />
          </View>
          <SkeletonCard variant="shelf" />
          <SkeletonCard variant="shelf" />
        </View>
        <View style={{ flex: 1 }} />
        <StackTabBar navigation={navigation} />
      </View>
    );
  }

  if (error || !channel) {
    return (
      <View style={styles.container}>
        <StackHeader onBack={() => goBackOrTab(navigation, 'Home')} />
        <EmptyState
          title="Channel unavailable"
          message={error ?? 'This channel could not be loaded.'}
          actionLabel="Go back"
          onAction={() => goBackOrTab(navigation, 'Home')}
        />
        <StackTabBar navigation={navigation} />
      </View>
    );
  }

  // Uploads grid: Shorts filtered OUT with the search stream's
  // heuristic (user ban), ghost items (no title) dropped. The About
  // tab has no list rows — its content renders from ListEmptyComponent.
  const data = (tab === 'videos' ? uploads : tab === 'live' ? mergedLive : []).filter(
    (v) => v.title.trim().length > 0 && (tab !== 'videos' || !isShortVideo(v)),
  );

  return (
    <View style={styles.container}>
      {ptr.indicator}
      <FlatList
        {...ptr.listProps}
        refreshing={refreshing}
        onRefresh={onRefresh}
        key={`cols-${columns}`}
        data={data}
        numColumns={columns}
        columnWrapperStyle={columns > 1 ? styles.columnWrapper : undefined}
        renderItem={renderVideo}
        keyExtractor={keyExtractor}
        ListHeaderComponent={header ?? undefined}
        contentContainerStyle={[styles.listPad, { paddingBottom: layout.bottomNavHeight + insets.bottom + 24 }]}
        onEndReached={tab === 'videos' ? loadMore : undefined}
        onEndReachedThreshold={0.6}
        ListFooterComponent={
          // Skeleton footer, not a bare spinner (audit A11): the
          // list keeps its card rhythm while the next page loads.
          loadingMore ? (
            <View style={styles.footerSkeleton}>
              <SkeletonCard variant="shelf" />
            </View>
          ) : undefined
        }
        ListEmptyComponent={
          // About tab (round-3 sweep, 27 Nov 2026): YouTube's channel
          // page has an About section — description, counts, joined
          // date, location. Every row is the channel's own data from
          // channels.list; rows with no data are omitted, never
          // invented. Links are not shown: the API exposes none.
          tab === 'about' ? (
            <View style={styles.aboutWrap}>
              <Text style={styles.aboutHeading}>Description</Text>
              {channel.description ? (
                <LinkedText text={channel.description} style={styles.description} />
              ) : (
                <Text style={styles.aboutEmpty}>No description for this channel.</Text>
              )}
              <View style={styles.aboutStats}>
                {channel.subscriberCount != null ? (
                  <View style={styles.aboutRow}>
                    <Text style={styles.aboutLabel}>Subscribers</Text>
                    <Text style={styles.aboutValue}>{formatCount(channel.subscriberCount)}</Text>
                  </View>
                ) : null}
                {channel.videoCount != null ? (
                  <View style={styles.aboutRow}>
                    <Text style={styles.aboutLabel}>Videos</Text>
                    <Text style={styles.aboutValue}>{formatCount(channel.videoCount)}</Text>
                  </View>
                ) : null}
                {channel.viewCount != null ? (
                  <View style={styles.aboutRow}>
                    <Text style={styles.aboutLabel}>Total views</Text>
                    <Text style={styles.aboutValue}>{formatCount(channel.viewCount)}</Text>
                  </View>
                ) : null}
                {channel.publishedAt ? (
                  <View style={styles.aboutRow}>
                    <Text style={styles.aboutLabel}>Joined</Text>
                    <Text style={styles.aboutValue}>{formatDateLine(channel.publishedAt)}</Text>
                  </View>
                ) : null}
                {channel.country ? (
                  <View style={styles.aboutRow}>
                    <Text style={styles.aboutLabel}>Location</Text>
                    <Text style={styles.aboutValue}>{countryName(channel.country)}</Text>
                  </View>
                ) : null}
              </View>
            </View>
          ) : // QA issue 8: while the tab's data is still loading, show
          // skeleton rows — previously this was `undefined` (videos)
          // or a premature "No live…" message (live), i.e. a blank
          // white area / wrong state for the whole fetch.
          (tab === 'videos' && loading) || (tab === 'live' && !liveLoaded) ? (
            <View>
              <SkeletonCard variant="shelf" />
              <SkeletonCard variant="shelf" />
              <SkeletonCard variant="shelf" />
            </View>
          ) : tab === 'live' && liveError ? (
            // The live check FAILED (e.g. API quota) — say so and
            // offer Retry; never dress a failure up as "not live".
            <EmptyState
              title="Couldn't check live status"
              message="The live check failed, so this channel may still be live. Try again in a moment."
              actionLabel="Try again"
              onAction={retryLive}
            />
          ) : tab === 'live' ? (
            <EmptyState
              title="No live or upcoming broadcasts"
              message="This channel is not live right now and has no upcoming broadcasts scheduled on YouTube."
            />
          ) : (
            <EmptyState title="No videos found" message="This channel's uploads could not be listed." />
          )
        }
        {...FEED_LIST_PERF}
      />
      <StackTabBar navigation={navigation} />
      <Modal visible={menuOpen} transparent animationType="fade" onRequestClose={() => setMenuOpen(false)}>
        <Pressable style={styles.menuBackdrop} onPress={() => setMenuOpen(false)}>
          <Pressable style={styles.menuCard} onPress={() => undefined}>
            <Pressable
              style={({ pressed }) => [styles.menuRow, pressed && styles.menuRowPressed]}
              accessibilityRole="button"
              onPress={() => {
                setMenuOpen(false);
                void Linking.openURL(`https://www.youtube.com/channel/${channelId}`);
              }}
            >
              <MaterialIcons name="open-in-new" size={22} color={colors.text} />
              <Text style={styles.menuText}>Open in YouTube</Text>
            </Pressable>
            <Pressable
              style={({ pressed }) => [styles.menuRow, pressed && styles.menuRowPressed]}
              accessibilityRole="button"
              onPress={() => {
                setMenuOpen(false);
                void shareContent(
                  channel.title,
                  channelShareUrl(channelId),
                ).then((outcome) => {
                  const feedback = shareFeedback(outcome);
                  if (feedback) showToast(feedback);
                });
              }}
            >
              <MaterialIcons name="share" size={22} color={colors.text} />
              <Text style={styles.menuText}>Share channel</Text>
            </Pressable>
            <Pressable
              style={({ pressed }) => [styles.menuRow, pressed && styles.menuRowPressed]}
              accessibilityRole="button"
              onPress={() => {
                setMenuOpen(false);
                navigation.navigate('Sessions');
              }}
            >
              <MaterialIcons name="groups" size={22} color={colors.text} />
              <Text style={styles.menuText}>Samagam Sessions</Text>
            </Pressable>
            <Pressable
              style={({ pressed }) => [styles.menuRow, pressed && styles.menuRowPressed]}
              accessibilityRole="button"
              onPress={() => setMenuOpen(false)}
            >
              <MaterialIcons name="close" size={22} color={colors.text} />
              <Text style={styles.menuText}>Cancel</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
      <Toast message={toast} />
    </View>
  );
}

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  listPad: { paddingHorizontal: spacing.lg },
  topBarBleed: { marginHorizontal: -spacing.lg },
  banner: {
    // Full-bleed: escape the list's horizontal padding (same trick
    // as topBar), NO radius, and the aspect of the crop the API URL
    // actually serves — verified live 2026-11-26: bannerDisplayUrl's
    // fcrop URL returns 1546x256 (aspect 6.04), containing only the
    // artwork band. The previous 1546/423 container was taller than
    // the served image, so cover-fit scaled the art up and cropped
    // its sides; at 1546/256 the strip shows the whole band
    // edge-to-edge with no letterbox and no crop.
    marginHorizontal: -spacing.lg,
    aspectRatio: 1546 / 256,
    backgroundColor: colors.surfaceVariant,
  },
  identity: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.lg,
    paddingTop: spacing.lg,
  },
  identityLines: { flex: 1 },
  nameRow: { flexDirection: 'row', alignItems: 'flex-start' },
  verifiedBadge: { marginLeft: spacing.xs, marginTop: 5, flexShrink: 0 },
  identityActions: { marginTop: spacing.lg },
  avatarClip: {
    width: nativeApp.searchChannel.avatarSize, // 88 — ref-3 channel block
    height: nativeApp.searchChannel.avatarSize,
    borderRadius: nativeApp.searchChannel.avatarSize / 2,
    overflow: 'hidden',
  },
  avatar: {
    width: nativeApp.searchChannel.avatarSize,
    height: nativeApp.searchChannel.avatarSize,
  },
  avatarFallback: {
    backgroundColor: colors.surfaceVariant,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarWrap: { position: 'relative' },
  avatarLiveRing: { borderWidth: 2, borderColor: colors.accent },
  avatarLivePill: {
    position: 'absolute',
    bottom: -6,
    alignSelf: 'center',
    backgroundColor: colors.accent,
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
  avatarLiveText: { color: '#FFFFFF', fontSize: 10, fontWeight: '700' },
  avatarInitial: { fontSize: 30, fontWeight: '600', color: colors.textSecondary },
  name: {
    fontSize: nativeApp.searchChannel.nameFontSize, // 20
    lineHeight: 25,
    fontWeight: '700',
    color: colors.text,
    flexShrink: 1,
  },
  handleLine: {
    fontSize: 14,
    color: colors.textSecondary,
    marginTop: 3,
  },
  metaLine: {
    fontSize: 14,
    color: colors.textSecondary,
    marginTop: 2,
  },
  description: {
    fontSize: 14,
    lineHeight: 20,
    color: colors.textSecondary,
    marginTop: spacing.sm,
  },
  gridCell: { flex: 1 },
  columnWrapper: { gap: spacing.lg },
  descriptionWrap: { marginTop: spacing.md },
  moreText: { fontSize: 14, fontWeight: '600', color: colors.text, marginTop: spacing.xs },
  subscribePill: {
    alignSelf: 'stretch',
    height: 44, // m.youtube reference ~41px; 44 meets the app's own tap minimum (audit A3)
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: colors.subscribeBackground,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.lg,
  },
  subscribePillActive: { backgroundColor: colors.surfaceVariant },
  subscribeText: { fontSize: 15, fontWeight: '600', color: colors.subscribeText },
  subscribeTextActive: { color: colors.text },
  followNote: { fontSize: 11, color: colors.textSecondary, marginTop: 6 },
  skelBanner: {
    marginHorizontal: -spacing.lg,
    aspectRatio: 1546 / 256,
    backgroundColor: colors.surfaceVariant,
  },
  skelIdentity: { flexDirection: 'row', gap: spacing.lg, paddingTop: spacing.lg },
  skelAvatar: {
    width: nativeApp.searchChannel.avatarSize,
    height: nativeApp.searchChannel.avatarSize,
    borderRadius: nativeApp.searchChannel.avatarSize / 2,
    backgroundColor: colors.surfaceVariant,
  },
  skelLines: { flex: 1, justifyContent: 'center', gap: spacing.sm },
  skelBar: { height: 14, borderRadius: 7, backgroundColor: colors.surfaceVariant },
  skelPills: { marginTop: spacing.lg, marginBottom: spacing.xl },
  skelPill: {
    height: 40,
    borderRadius: radii.pill,
    backgroundColor: colors.surfaceVariant,
  },
  tabs: {
    flexDirection: 'row',
    gap: spacing.xl,
    marginTop: spacing.xl,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  tab: { paddingBottom: spacing.sm },
  tabActive: { borderBottomWidth: 2, borderBottomColor: colors.text },
  tabLabel: { fontSize: 15, fontWeight: '500', color: colors.textSecondary },
  tabLabelActive: { color: colors.text, fontWeight: '600' },
  aboutWrap: { paddingTop: spacing.md, paddingBottom: spacing.xl },
  aboutHeading: {
    ...typography.body,
    fontWeight: '700',
    color: colors.text,
    marginBottom: spacing.sm,
  },
  aboutEmpty: { ...typography.body, color: colors.textSecondary },
  aboutStats: { marginTop: spacing.lg },
  aboutRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  aboutLabel: { ...typography.body, color: colors.textSecondary },
  aboutValue: { ...typography.body, fontWeight: '600', color: colors.text },
  footerSpinner: { paddingVertical: spacing.lg },
  footerSkeleton: { paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  ptrWrap: { flex: 1 },
  menuBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
  },
  menuCard: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: colors.surface,
    borderRadius: 16,
    paddingVertical: spacing.sm,
  },
  menuRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  menuRowPressed: { backgroundColor: colors.surfaceVariant },
  menuText: { fontSize: 15, color: colors.text },
});
