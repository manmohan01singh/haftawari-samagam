import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Image } from 'expo-image';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { CardActionSheet } from '../../components/common/CardActionSheet';
import { EmptyState } from '../../components/common/EmptyState';
import { LinkedText } from '../../components/common/LinkedText';
import { Toast, useToast } from '../../components/common/Toast';
import { shareContent, shareFeedback } from '../../lib/share';
import { FeedCard } from '../../components/video/FeedCard';
import { YouTubePlayer } from '../../components/video/YouTubePlayer';
import {
  apiCardData,
  supabaseCardData,
  formatDateLine,
  type CardVideoData,
} from '../../components/video/cardData';
import { useAuth } from '../../features/auth';
import { ChatPreviewCard, SessionChat } from '../../features/chat/components';
import { useChannelFollow, useOfficialChannel } from '../../features/channel';
import { AddToPlaylistSheet } from '../../features/library';
import { formatCount } from '../../lib/format';
import { FEED_LIST_PERF } from '../../lib/listPerf';
import { isSupabaseConfigured } from '../../lib/supabase';
import {
  OFFICIAL_CHANNEL_HANDLE,
  OFFICIAL_CHANNEL_ID,
  fetchChannelById,
  fetchChannelUploads,
  fetchVideoMetadata,
  type YouTubeChannelInfo,
  type YouTubeVideoMetadata,
} from '../../lib/youtube';
import {
  fetchSavedVideoIds,
  fetchUpNext,
  fetchVideoByRowId,
  recordWatchHistory,
  setVideoSaved,
} from '../../lib/videos';
import { layout, lightColors, nativeApp, radii, spacing, typography } from '../../theme';
import { goBackOrTab } from '../../navigation/safeBack';
import { BackButton } from '../../components/layout/StackHeader';
import { recordLocalWatch } from '../../features/library/localHistory';
import { ICON_HIT_SLOP } from '../../lib/touch';
import type { Video } from '../../types/database';
import type { RootStackParamList } from '../../navigation/types';

type Props = NativeStackScreenProps<RootStackParamList, 'Watch'>;

interface ResolvedWatch {
  youtubeVideoId: string;
  title: string;
  description: string;
  channelId: string | null;
  channelTitle: string;
  metaLine: string;
  thumbnailUrl: string | null;
  /** Real duration (API contentDetails or the catalogue row). */
  durationSeconds: number | null;
  row: Video | null;
  /** True only when the YouTube API itself reports this video live. */
  isLive: boolean;
}

/**
 * Watch screen (reference §5 geometry): player pinned at the top, then
 * a white sheet with 20px rounded top corners overlapping the player's
 * bottom edge holding title, metadata, channel row, action row and
 * description; Up Next continues below as full feed cards.
 *
 * Playback is the OFFICIAL YouTube embed only, mounted lazily after
 * the navigation transition settles so the screen opens smoothly.
 * Session (Samagam) playback + live chat arrive in Phase 3; this
 * screen plays archive recordings.
 */
export function WatchScreen({ route, navigation }: Props) {
  const { videoRowId, youtubeVideoId, sessionId } = route.params;
  const { user } = useAuth();
  const officialChannel = useOfficialChannel();
  // The resolved video is stored keyed by its route params; loading and
  // error are derived from whether the stored entry matches the current
  // params (no synchronous setState in the fetch effect).
  const watchKey = `${videoRowId ?? ''}|${youtubeVideoId ?? ''}`;
  const [watchState, setWatchState] = useState<{
    key: string;
    resolved: ResolvedWatch | null;
    error: string | null;
  }>({ key: '', resolved: null, error: null });
  const resolved = watchState.key === watchKey ? watchState.resolved : null;
  const error = watchState.key === watchKey ? watchState.error : null;
  const loading = watchState.key !== watchKey;
  const [channel, setChannel] = useState<YouTubeChannelInfo | null>(null);
  // Bell pill (reference §5): the Subscribed pill's geometry — bell +
  // chevron in a light-grey pill. There is no subscriptions backend,
  // so this drives the honest DEVICE-LOCAL follow state shared with
  // the Channel/Search screens (useChannelFollow): it never claims a
  // YouTube subscription and never changes any subscriber count.
  const { following, toggleFollow } = useChannelFollow(channel?.channelId ?? OFFICIAL_CHANNEL_ID);
  const [menuOpen, setMenuOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  // Up Next items: local catalogue rows first; when the catalogue is
  // thin, real channel uploads from the YouTube API fill the list
  // (QA issue 58) — same compact-row rendering either way.
  type UpNextItem =
    | { kind: 'row'; video: Video }
    | { kind: 'api'; meta: YouTubeVideoMetadata };
  const [upNextItems, setUpNextItems] = useState<UpNextItem[]>([]);
  const [expanded, setExpanded] = useState(false);
  const [readyFor, setReadyFor] = useState<string | null>(null);
  const playerReady = resolved != null && readyFor === resolved.youtubeVideoId;
  const [savedState, setSavedState] = useState<{ rowId: string; saved: boolean } | null>(null);
  // Like/Dislike (round-3): NO state at all. The pair previously kept
  // a local toggle that rendered a FILLED black thumb — a persistent
  // "you liked this" claim with no backend behind it, i.e. fabricated
  // data (app-watch-live2.jpg). The icons now stay outline-only and a
  // tap answers honestly via toast that nothing was recorded. The
  // real like count, when the API provides one, lives in the meta
  // line — that is YouTube's count, not the user's action.
  const [playlistSheetOpen, setPlaylistSheetOpen] = useState(false);
  const { toast, showToast } = useToast();
  const saved =
    resolved?.row && savedState?.rowId === resolved.row.id ? savedState.saved : false;
  const localHistoryRecordedFor = useRef<string | null>(null);
  const serverHistoryRecordedFor = useRef<string | null>(null);

  // Resolve the video from Supabase (archive row) or the YouTube API.
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        let row: Video | null = null;
        let meta: YouTubeVideoMetadata | null = null;
        if (videoRowId && isSupabaseConfigured) {
          row = await fetchVideoByRowId(videoRowId);
          if (!row) throw new Error('This recording could not be found.');
        }
        const ytId = row?.youtube_video_id ?? youtubeVideoId;
        if (!ytId) throw new Error('This recording could not be found.');
        // QA issue 55: ALWAYS enrich from the YouTube API when it is
        // reachable — even for archive rows — so the sheet's meta
        // line carries the real likes / watching / views / hashtags
        // of screenshot 06 instead of a bare date. Failure to enrich
        // is not fatal for archive rows (the row itself is the data);
        // it IS fatal when there is no row at all.
        meta = await fetchVideoMetadata(ytId).catch(() => null);
        if (!row && !meta) throw new Error('This recording could not be found on YouTube.');
        if (!active) return;
        const isLive = meta?.liveBroadcastContent === 'live';
        const metaParts: string[] = [];
        if (meta) {
          // Reference §5 meta line, ONE line, in this order:
          // @handle · N likes · N watching (live) or ▷ N views
          // (recorded) · date · #hashtag · more. The previous build
          // pushed "watching" TWICE for live videos and put it before
          // likes — screenshot order is likes first, watching second,
          // each exactly once.
          if (meta.likeCount != null) metaParts.push(`${formatCount(meta.likeCount)} likes`);
          if (isLive) {
            if (meta.concurrentViewers != null) {
              metaParts.push(`${formatCount(meta.concurrentViewers)} watching`);
            }
          } else if (meta.viewCount != null) {
            // Reference: view counts in metadata lines carry the ▷
            // prefix ("▷ 3.3 lakh", "▷332 watching").
            metaParts.push(`▷ ${formatCount(meta.viewCount)} views`);
          }
          // ONE date format everywhere: formatDateLine (en-IN,
          // "30 Nov 2020") — the same helper the cards use.
          metaParts.push(formatDateLine(meta.publishedAt));
          // Hashtags come from the video's OWN description text
          // (real API data), first two, as in the reference meta line.
          const tags = [...new Set((meta.description.match(/#[\p{L}\p{N}_]+/gu) ?? []).slice(0, 2))];
          metaParts.push(...tags);
        } else if (row) {
          metaParts.push(formatDateLine(row.published_at ?? row.created_at));
        }
        setWatchState({
          key: watchKey,
          resolved: {
            youtubeVideoId: ytId,
            title: row?.title ?? meta?.title ?? '',
            description: row?.description ?? meta?.description ?? '',
            channelId: meta?.channelId ?? null,
            channelTitle: meta?.channelTitle ?? officialChannel?.title ?? '',
            metaLine: metaParts.filter(Boolean).join(' · '),
            thumbnailUrl: row?.thumbnail_url ?? meta?.thumbnailUrl ?? null,
            durationSeconds: meta?.durationSeconds ?? row?.duration_seconds ?? null,
            row,
            isLive,
          },
          error: null,
        });
      } catch (e) {
        if (active) {
          setWatchState({
            key: watchKey,
            resolved: null,
            error: e instanceof Error ? e.message : 'Could not load this recording.',
          });
        }
      }
    })();
    return () => {
      active = false;
    };
    // officialChannel intentionally not a dependency: it only fills a
    // fallback title; the channel fetch below provides the real row.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoRowId, youtubeVideoId, watchKey]);

  // Channel info for the channel row (official channel for archive rows).
  useEffect(() => {
    if (!resolved) return;
    if (!resolved.row && !resolved.channelId) return;
    let active = true;
    const target = resolved.row ? null : resolved.channelId;
    const promise = target ? fetchChannelById(target) : Promise.resolve(officialChannel);
    void promise
      .then((info) => {
        if (active) setChannel(info);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [resolved, officialChannel]);

  // Up Next: other published archive recordings first; if the local
  // catalogue is thin (< 4), fall back to the channel's real uploads
  // via the YouTube API (QA issue 58 — the channel has far more
  // videos than the seeded catalogue).
  const currentYtId = resolved?.youtubeVideoId ?? youtubeVideoId ?? null;
  useEffect(() => {
    let active = true;
    (async () => {
      const rows = isSupabaseConfigured
        ? await fetchUpNext(videoRowId ?? null).catch(() => [] as Video[])
        : [];
      const items: UpNextItem[] = rows.map((video) => ({ kind: 'row' as const, video }));
      if (items.length < 4 && officialChannel?.uploadsPlaylistId) {
        const page = await fetchChannelUploads(officialChannel.uploadsPlaylistId).catch(() => null);
        if (page) {
          const seen = new Set(rows.map((r) => r.youtube_video_id));
          if (currentYtId) seen.add(currentYtId);
          for (const meta of page.videos) {
            if (!seen.has(meta.youtubeVideoId)) items.push({ kind: 'api' as const, meta });
          }
        }
      }
      if (active) setUpNextItems(items.slice(0, 15));
    })();
    return () => {
      active = false;
    };
  }, [videoRowId, officialChannel, currentYtId]);

  // Saved state for archive rows (stored keyed by row id).
  useEffect(() => {
    if (!user || !resolved?.row) return;
    const rowId = resolved.row.id;
    let active = true;
    fetchSavedVideoIds(user.id)
      .then((ids) => {
        if (active) setSavedState({ rowId, saved: ids.has(rowId) });
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [user, resolved]);

  // ── History write path (round-3 audit — the user, signed in,
  // watched live videos all morning and History stayed empty) ──
  // The old single effect had THREE holes:
  //  1. Signed-in + API-only video (every live/upload opened from
  //     Home/Search/Subscriptions/Channel/Up Next, which pass only a
  //     youtubeVideoId and have NO catalogue row): neither branch
  //     fired — no server row (watch_history.video_id is an FK to
  //     videos, so none can exist) and no local entry either.
  //  2. Auth race: one shared "recorded" guard was set by whichever
  //     branch ran first. On the PWA the session restores async, so
  //     the effect usually ran signed-OUT (local write, guard set);
  //     when the user arrived a moment later the guard blocked the
  //     server write for catalogue rows too.
  //  3. API-only entries lost their duration (only row durations
  //     were stored).
  // Now the two stores are written by separate effects with separate
  // guards:
  //  - LOCAL: every watch, signed in or out, row or API-only, once
  //    per video per mount, with youtube_video_id + title +
  //    thumbnail + duration — everything the History screen needs
  //    to render the entry.
  //  - SERVER: catalogue rows only, fired when the signed-in user
  //    is known (whenever auth resolves), once per row per mount.
  useEffect(() => {
    if (!resolved) return;
    if (localHistoryRecordedFor.current === resolved.youtubeVideoId) return;
    localHistoryRecordedFor.current = resolved.youtubeVideoId;
    void recordLocalWatch({
      youtubeVideoId: resolved.youtubeVideoId,
      videoRowId: resolved.row?.id ?? null,
      title: resolved.title,
      thumbnailUrl: resolved.thumbnailUrl,
      durationSeconds: resolved.durationSeconds,
    }).catch(() => undefined);
  }, [resolved]);

  useEffect(() => {
    if (!resolved?.row || !user) return;
    if (serverHistoryRecordedFor.current === resolved.row.id) return;
    serverHistoryRecordedFor.current = resolved.row.id;
    void recordWatchHistory(user.id, resolved.row.id).catch(() => undefined);
  }, [user, resolved]);

  // Lazy player mount: mark this video ready only after the navigation
  // transition settles (timer callback), so the screen opens smoothly
  // and the embed never loads on any other screen.
  useEffect(() => {
    if (!resolved) return;
    const ytId = resolved.youtubeVideoId;
    const t = setTimeout(() => setReadyFor(ytId), 60);
    return () => clearTimeout(t);
  }, [resolved]);

  const onShare = useCallback(() => {
    if (!resolved) return;
    void shareContent(
      resolved.title,
      `https://www.youtube.com/watch?v=${resolved.youtubeVideoId}`,
    ).then((outcome) => {
      const feedback = shareFeedback(outcome);
      if (feedback) showToast(feedback);
    });
  }, [resolved, showToast]);

  const onToggleSave = useCallback(() => {
    if (!user || !resolved?.row) return;
    const rowId = resolved.row.id;
    const next = !saved;
    setSavedState({ rowId, saved: next });
    void setVideoSaved(user.id, rowId, next).catch(() =>
      setSavedState({ rowId, saved: !next }),
    );
  }, [user, resolved, saved]);

  const renderUpNext = useCallback(
    ({ item }: { item: UpNextItem }) => {
      const shareItem = (title: string, youtubeVideoId: string) => {
        void shareContent(title, `https://www.youtube.com/watch?v=${youtubeVideoId}`).then(
          (outcome) => {
            const feedback = shareFeedback(outcome);
            if (feedback) showToast(feedback);
          },
        );
      };
      if (item.kind === 'api') {
        const data: CardVideoData = apiCardData(item.meta, officialChannel?.avatarUrl ?? null);
        return (
          <FeedCard
            variant="upNext"
            data={data}
            onPress={() => navigation.push('Watch', { youtubeVideoId: item.meta.youtubeVideoId })}
            onShare={() => shareItem(item.meta.title, item.meta.youtubeVideoId)}
            onChannelPress={() =>
              navigation.navigate('Channel', { channelId: officialChannel?.channelId })
            }
            menuActions={[
              {
                key: 'share',
                label: 'Share',
                icon: 'share',
                onPress: () => shareItem(item.meta.title, item.meta.youtubeVideoId),
              },
            ]}
          />
        );
      }
      const data: CardVideoData = supabaseCardData(item.video, officialChannel?.avatarUrl ?? null);
      return (
        <FeedCard
          variant="upNext"
          data={data}
          onPress={() => navigation.push('Watch', { videoRowId: item.video.id })}
          onShare={() => shareItem(item.video.title, item.video.youtube_video_id)}
          onChannelPress={() =>
            navigation.navigate('Channel', { channelId: officialChannel?.channelId })
          }
          menuActions={[
            {
              key: 'share',
              label: 'Share',
              icon: 'share',
              onPress: () => shareItem(item.video.title, item.video.youtube_video_id),
            },
          ]}
        />
      );
    },
    [navigation, officialChannel, showToast],
  );

  const keyExtractor = useCallback(
    (item: UpNextItem) => (item.kind === 'row' ? `sb-${item.video.id}` : `yt-${item.meta.youtubeVideoId}`),
    [],
  );

  // Player element — rendered OUTSIDE the FlatList (see the return
  // below) so it stays pinned at the top while Up Next scrolls, as in
  // screenshot 06. Previously it lived inside ListHeaderComponent and
  // scrolled away with the sheet.
  const player = resolved ? (
    <View style={styles.playerWrap}>
      {playerReady ? (
        <YouTubePlayer youtubeVideoId={resolved.youtubeVideoId} />
      ) : (
        <>
          {resolved.thumbnailUrl ? (
            <Image
              source={{ uri: resolved.thumbnailUrl }}
              style={styles.playerThumb}
              contentFit="cover"
              cachePolicy="memory-disk"
            />
          ) : (
            <View style={styles.playerThumb} />
          )}
          <View style={styles.playerSpinner}>
            <ActivityIndicator color="#FFFFFF" />
          </View>
        </>
      )}
      {/* Round-3 (user's phone, 27 Nov): NOTHING of ours overlays the
          player rectangle — no back arrow, no LIVE pill. The old
          back overlay sat on top of the embed's own title/channel
          icon ("LIVE | Dhan Guru…" was cut), and our LIVE pill
          duplicated the embed's own LIVE badge. The embed's own
          branding/badges stay exactly as YouTube serves them; the
          back control lives in the sheet's header zone (below). The
          only thing inside this rectangle besides the embed is its
          own loading poster (thumbnail + spinner, pointer-events
          none), removed the moment the embed mounts. */}
    </View>
  ) : null;

  // Back control (round-3): a plain dark arrow in the SHEET's header
  // zone, above the title — never on the video. Shared by the loaded,
  // loading and error states so the exit is always in the same place.
  const backRow = useMemo(
    () => (
      <View style={styles.backRow}>
        <BackButton onPress={() => goBackOrTab(navigation, 'Home')} />
      </View>
    ),
    [navigation],
  );

  const header = useMemo(() => {
    if (!resolved) return null;
    const channelName = channel?.title ?? resolved.channelTitle;
    const channelAvatar = channel?.avatarUrl ?? null;
    // Screenshot 06 metadata line: "@handle · N likes · ▷ N views ·
    // date · #tag · more" — ONE single line, parts joined only when
    // present. Archive rows belong to the official channel, so its
    // real handle fills in until the channel fetch lands (the old
    // build left the handle out entirely in that window).
    const handle = channel?.handle ?? (resolved.row ? OFFICIAL_CHANNEL_HANDLE : null);
    const metaText = [handle, resolved.metaLine].filter(Boolean).join(' · ');
    return (
      <View>
        {/* Seam (round-3, ref-watch-live): for a video the API itself
            reports live, a thin red line sits exactly at the
            player/sheet seam — the live edge, as in the real app.
            Recorded videos get no line: their progress position is
            not ours to invent. */}
        {resolved.isLive ? <View style={styles.seamLine} /> : null}
        <View style={styles.sheet}>
          {backRow}
          <Text style={styles.title} numberOfLines={expanded ? undefined : 2}>
            {resolved.title}
          </Text>
          <Pressable
            onPress={() => setExpanded((v) => !v)}
            hitSlop={{ top: 10, bottom: 10, left: 0, right: 0 }}
            accessibilityRole="button"
            accessibilityLabel={expanded ? 'Show less' : 'Show more'}
          >
            <Text style={styles.metaLine} numberOfLines={1}>
              {metaText}
              {metaText ? '  ' : ''}
              <Text style={styles.moreText}>{expanded ? 'less' : 'more'}</Text>
            </Text>
          </Pressable>

          {/* QA issue 62: the whole channel row is the tap target to
              the Channel page; the name is one line, tail-ellipsis. */}
          <Pressable
            style={styles.channelRow}
            onPress={() => navigation.navigate('Channel', { channelId: channel?.channelId })}
            accessibilityRole="button"
            accessibilityLabel={`View channel ${channelName}`}
          >
            {channelAvatar ? (
              <Image
                source={{ uri: channelAvatar }}
                style={styles.channelAvatar}
                contentFit="cover"
                cachePolicy="memory-disk"
              />
            ) : (
              <View style={[styles.channelAvatar, styles.avatarFallback]}>
                <Text style={styles.avatarInitial}>{channelName.charAt(0).toUpperCase()}</Text>
              </View>
            )}
            <View style={styles.channelLines}>
              <Text style={styles.channelName} numberOfLines={1} ellipsizeMode="tail">
                {channelName}
              </Text>
              {channel?.subscriberCount != null ? (
                <Text style={styles.channelMeta} numberOfLines={1}>
                  {`${formatCount(channel.subscriberCount)} subscribers`}
                </Text>
              ) : null}
            </View>
          </Pressable>

          {/* Action row (screenshot 06): at left the light-grey bell
              pill in the Subscribed pill's exact geometry (bell +
              chevron-down). It toggles the device-local follow state
              (see useChannelFollow above) — it is NOT labelled
              "Subscribed" because there is no subscription backend.
              Right-aligned icon-only group: Like / Dislike / Share /
              Save / ⋮, 24px, no counts, no labels. The reference's
              sparkle (Ask) slot is NOT rendered: this app has no Ask
              backend, and a dead sparkle would be a fake action —
              flagged in the QA report. Like/Dislike keep the row's
              geometry but hold NO state (round-3): outline icons
              only, a tap toasts honestly that nothing is recorded. */}
          <View style={styles.actionRow}>
            <Pressable
              style={styles.channelPill}
              onPress={() => {
                toggleFollow();
                showToast(
                  following
                    ? 'Removed from your followed channels on this device'
                    : 'Following this channel on this device',
                );
              }}
              accessibilityRole="button"
              accessibilityLabel={following ? 'Following this channel' : 'Follow this channel'}
              accessibilityState={{ selected: following }}
            >
              <MaterialIcons
                name={following ? 'notifications' : 'notifications-none'}
                size={20}
                color={lightColors.text}
              />
              <MaterialIcons name="expand-more" size={18} color={lightColors.text} />
            </Pressable>
            <View style={styles.actions}>
              <Pressable
                onPress={() => showToast('Likes are not available in this app yet — nothing was recorded')}
                hitSlop={ICON_HIT_SLOP}
                accessibilityLabel="Like"
                accessibilityRole="button"
              >
                <MaterialIcons name="thumb-up-off-alt" size={24} color={lightColors.text} />
              </Pressable>
              <Pressable
                onPress={() => showToast('Dislikes are not available in this app yet — nothing was recorded')}
                hitSlop={ICON_HIT_SLOP}
                accessibilityLabel="Dislike"
                accessibilityRole="button"
              >
                <MaterialIcons name="thumb-down-off-alt" size={24} color={lightColors.text} />
              </Pressable>
              <Pressable onPress={onShare} hitSlop={ICON_HIT_SLOP} accessibilityLabel="Share" accessibilityRole="button">
                <MaterialIcons name="share" size={23} color={lightColors.text} />
              </Pressable>
              {resolved.row ? (
                <Pressable
                  onPress={user ? onToggleSave : () => navigation.navigate('SignIn')}
                  hitSlop={ICON_HIT_SLOP}
                  accessibilityLabel={saved ? 'Remove from saved' : 'Save'}
                  accessibilityRole="button"
                  accessibilityState={{ selected: saved }}
                >
                  <MaterialIcons name={saved ? 'bookmark' : 'bookmark-border'} size={24} color={lightColors.text} />
                </Pressable>
              ) : null}
              {/* ⋮ (screenshot 06's horizontal •••): opens the real
                  action menu (Share / Save / Save to playlist / View
                  Channel) — always present, for API-only videos too.
                  Previously this icon was hidden for non-archive
                  videos and, when shown, opened the playlist sheet
                  directly under a misleading "more" glyph. */}
              <Pressable
                onPress={() => setMenuOpen(true)}
                hitSlop={ICON_HIT_SLOP}
                accessibilityLabel="More actions"
                accessibilityRole="button"
              >
                <MaterialIcons name="more-horiz" size={24} color={lightColors.text} />
              </Pressable>
            </View>
          </View>

          {/* Live chat preview (reference §5 + round-3): rendered
              ONLY when this watch was opened for a real Samagam
              session (route carries a sessionId) — the grey box,
              "Live chat" label and the signed-in user's own
              "Chat publicly as …" pill, in ChatPreviewCard's ref
              geometry (radius 16, padding 12, avatar 36). Tapping it
              opens the real SessionChat sheet (rendered at the root
              below). A plain recording has no session and gets NO
              chat box — a "Live chat" label under a prerecorded
              video would mislabel it. No participant count is passed:
              this screen does not join Presence, so the count is
              honestly hidden rather than invented. */}
          {sessionId ? (
            <View style={styles.chatWrap}>
              <ChatPreviewCard
                sessionId={sessionId}
                onPress={() => setChatOpen(true)}
                onSignInPress={() => navigation.navigate('SignIn')}
              />
            </View>
          ) : null}

          {/* QA issues 55/65: a description PREVIEW box is visible in
              the collapsed state (2 lines, tap to expand); in the
              expanded state the box carries its own visible
              "Show less" collapse affordance — previously "less" was
              hidden inside the meta line only. Links inside the
              expanded description are tappable (LinkedText, QA 40). */}
          {resolved.description ? (
            expanded ? (
              <View style={styles.descriptionBox}>
                <LinkedText text={resolved.description} style={styles.descriptionText} />
                <Pressable
                  onPress={() => setExpanded(false)}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel="Show less"
                >
                  <Text style={styles.descriptionToggle}>Show less</Text>
                </Pressable>
              </View>
            ) : (
              <Pressable
                style={styles.descriptionBox}
                onPress={() => setExpanded(true)}
                accessibilityRole="button"
                accessibilityLabel="Show description"
              >
                <Text style={styles.descriptionText} numberOfLines={2} ellipsizeMode="tail">
                  {resolved.description}
                </Text>
                {/* Visible expand control, mirroring the expanded
                    state's "Show less" — the collapsed box previously
                    gave no sign it could be opened. */}
                <Text style={styles.descriptionToggle}>Show more</Text>
              </Pressable>
            )
          ) : null}
        </View>
      </View>
    );
  }, [
    resolved,
    channel,
    expanded,
    user,
    saved,
    onToggleSave,
    onShare,
    navigation,
    following,
    toggleFollow,
    showToast,
    backRow,
    sessionId,
  ]);

  if (loading) {
    return (
      <View style={styles.container}>
        {/* Player loading state: the video's REAL thumbnail (derived
            from the route's YouTube id when we have one) + spinner —
            never a long black box, and (round-3) NOTHING overlaid on
            it: the back control sits in the sheet skeleton below,
            exactly where it sits in the loaded sheet. */}
        <View style={styles.playerSkeleton}>
          {youtubeVideoId ? (
            <Image
              source={{ uri: `https://i.ytimg.com/vi/${encodeURIComponent(youtubeVideoId)}/hqdefault.jpg` }}
              style={styles.playerThumb}
              contentFit="cover"
              cachePolicy="memory-disk"
            />
          ) : null}
          <View style={styles.playerSpinner}>
            <ActivityIndicator color={youtubeVideoId ? '#FFFFFF' : lightColors.textSecondary} />
            {!youtubeVideoId ? (
              <Text style={styles.playerSkeletonLabel}>Loading recording…</Text>
            ) : null}
          </View>
        </View>
        <View style={styles.sheetSkeleton}>
          {backRow}
          <View style={[styles.skelLine, { width: '85%' }]} />
          <View style={[styles.skelLine, { width: '55%', marginTop: 8 }]} />
          <View style={styles.skelRow}>
            <View style={styles.skelAvatar} />
            <View style={{ flex: 1 }}>
              <View style={[styles.skelLine, { width: '40%', height: 14 }]} />
              <View style={[styles.skelLine, { width: '28%', height: 12, marginTop: 6 }]} />
            </View>
          </View>
        </View>
      </View>
    );
  }

  if (error || !resolved) {
    return (
      <View style={styles.container}>
        <View style={styles.playerSkeleton} />
        <View style={styles.sheetSkeleton}>{backRow}</View>
        <EmptyState
          title="Recording unavailable"
          message={error ?? 'This recording could not be loaded.'}
          actionLabel="Go back"
          onAction={() => goBackOrTab(navigation, 'Home')}
        />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {player}
      <FlatList
        data={upNextItems}
        renderItem={renderUpNext}
        keyExtractor={keyExtractor}
        ListHeaderComponent={
          <View>
            {header}
            {/* QA issue 56: an explicit "Up Next" heading above the
                compact rows (shown only when there are items). */}
            {upNextItems.length > 0 ? <Text style={styles.upNextHeading}>Up Next</Text> : null}
          </View>
        }
        ListEmptyComponent={
          <Text style={styles.upNextEmpty}>No other published recordings yet.</Text>
        }
        {...FEED_LIST_PERF}
      />
      {/* ⋮ action menu (screenshot 06 •••): only actions that really
          work here — Share (system sheet), Save + Save to playlist
          (saved_videos / playlists backends, archive rows + signed-in
          users; signed-out taps go to SignIn, as the Save icon does),
          and View Channel. */}
      <CardActionSheet
        visible={menuOpen}
        onClose={() => setMenuOpen(false)}
        actions={[
          { key: 'share', label: 'Share', icon: 'share', onPress: onShare },
          ...(resolved.row
            ? [
                {
                  key: 'save',
                  label: saved ? 'Remove from saved' : 'Save',
                  icon: saved ? 'bookmark' : 'bookmark-border',
                  onPress: user ? onToggleSave : () => navigation.navigate('SignIn'),
                },
                {
                  key: 'playlist',
                  label: 'Save to playlist',
                  icon: 'playlist-add',
                  onPress: user
                    ? () => setPlaylistSheetOpen(true)
                    : () => navigation.navigate('SignIn'),
                },
              ]
            : []),
          {
            key: 'channel',
            label: 'View Channel',
            icon: 'account-circle',
            onPress: () =>
              navigation.navigate('Channel', { channelId: channel?.channelId }),
          },
        ]}
      />
      {/* Live chat sheet — only reachable when a real sessionId
          opened this watch (the preview card above is its only
          doorway). Same host pattern as SessionWatchScreen:
          SessionChat owns its own height so the player stays
          visible above the sheet. */}
      {sessionId ? (
        <Modal
          visible={chatOpen}
          animationType="slide"
          transparent
          onRequestClose={() => setChatOpen(false)}
        >
          <View style={styles.chatBackdrop}>
            <Pressable
              style={styles.chatBackdropTap}
              onPress={() => setChatOpen(false)}
              accessibilityLabel="Close chat"
              accessibilityRole="button"
            />
            <View style={styles.chatSheetHost}>
              <SessionChat sessionId={sessionId} onClose={() => setChatOpen(false)} />
            </View>
          </View>
        </Modal>
      ) : null}
      {/* "Save to playlist" sheet (library stream) — archive rows and
          signed-in users only, matching the action button's gating. */}
      <AddToPlaylistSheet
        visible={playlistSheetOpen}
        userId={user?.id ?? null}
        videoId={resolved.row?.id ?? null}
        onClose={() => setPlaylistSheetOpen(false)}
      />
      <Toast message={toast} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: lightColors.background },
  playerWrap: {
    width: '100%',
    aspectRatio: layout.thumbnailAspectRatio,
    backgroundColor: lightColors.playerBackground,
  },
  playerThumb: { width: '100%', height: '100%', backgroundColor: lightColors.playerBackground },
  // Back control: the shared BackButton (Phase 9) in the sheet's
  // header zone, above the title — a plain dark arrow on white, 48dp
  // target; its -12 margin + centred glyph put the icon's left edge
  // at the sheet's 16dp content inset, aligned with the title text.
  backRow: { flexDirection: 'row', alignItems: 'center' },
  // Seam line (round-3): 3dp red strip pulled 3dp up onto the seam
  // between player and sheet; zIndex above the sheet so the strip
  // reads exactly at the boundary, as in ref-watch-live.
  seamLine: {
    height: 3,
    backgroundColor: lightColors.accent,
    marginTop: -3,
    zIndex: 2,
  },
  chatWrap: { marginTop: spacing.lg },
  chatBackdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.4)' },
  chatBackdropTap: { flex: 1 },
  chatSheetHost: { justifyContent: 'flex-end' },
  playerSpinner: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheet: {
    backgroundColor: lightColors.surface,
    // Screenshot 06 / token: exactly 20px rounded top corners
    // overlapping the player's bottom edge by the same 20px (the old
    // build used token+4 = 24 on both, which read visibly rounder
    // and ate 4px more of the player than the reference).
    borderTopLeftRadius: nativeApp.watchSheet.topRadius,
    borderTopRightRadius: nativeApp.watchSheet.topRadius,
    marginTop: -nativeApp.watchSheet.topRadius,
    paddingHorizontal: spacing.lg,
    // The back row occupies the sheet's header zone. Phase 9: the
    // shared BackButton is 48dp tall (was a hand-rolled 36dp), so top
    // padding drops to 0 — the title lands ≈4dp below the round-3
    // measured offset, the accepted cost of the standard 48dp target.
    paddingTop: 0,
    paddingBottom: spacing.md,
    zIndex: 1,
  },
  title: { fontSize: 20, lineHeight: 26, fontWeight: '600', color: lightColors.text },
  metaLine: { fontSize: 14, color: lightColors.textSecondary, marginTop: spacing.md },
  moreText: { color: lightColors.text, fontWeight: '600' },
  channelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacing.lg,
    gap: spacing.md,
  },
  channelAvatar: { width: 40, height: 40, borderRadius: 20 },
  avatarFallback: {
    backgroundColor: lightColors.surfaceVariant,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitial: { fontSize: 16, fontWeight: '600', color: lightColors.textSecondary },
  channelLines: { flex: 1, minWidth: 0 },
  channelName: { fontSize: 15, fontWeight: '600', color: lightColors.text },
  channelMeta: { fontSize: 13, color: lightColors.textSecondary, marginTop: 1 },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.md,
    gap: spacing.md,
  },
  channelPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    backgroundColor: lightColors.surfaceVariant,
    borderRadius: radii.pill,
    // Screenshot 06 bell pill: ≈52×40dp, icon-only (bell + chevron).
    paddingHorizontal: spacing.md + 2,
    paddingVertical: 9,
  },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 20, flexShrink: 0 },
  descriptionBox: {
    backgroundColor: lightColors.surfaceVariant,
    borderRadius: radii.card,
    padding: spacing.md,
    marginTop: spacing.lg,
  },
  descriptionText: { fontSize: 14, lineHeight: 20, color: lightColors.text },
  descriptionToggle: {
    fontSize: 14,
    fontWeight: '600',
    color: lightColors.text,
    marginTop: spacing.sm,
  },
  upNextHeading: {
    fontSize: 18,
    lineHeight: 24,
    fontWeight: '700',
    color: lightColors.text,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.sm,
  },
  upNextEmpty: {
    fontSize: 14,
    color: lightColors.textSecondary,
    textAlign: 'center',
    paddingVertical: spacing.xl,
  },
  playerSkeleton: {
    width: '100%',
    aspectRatio: layout.thumbnailAspectRatio,
    backgroundColor: lightColors.surfaceVariant,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  playerSkeletonLabel: { ...typography.metadata, color: lightColors.textSecondary },
  // The loading sheet keeps the real sheet's geometry (white surface,
  // 20px rounded top overlapping the player) so the layout does not
  // jump when the real sheet replaces it.
  sheetSkeleton: {
    backgroundColor: lightColors.surface,
    borderTopLeftRadius: nativeApp.watchSheet.topRadius,
    borderTopRightRadius: nativeApp.watchSheet.topRadius,
    marginTop: -nativeApp.watchSheet.topRadius,
    padding: spacing.lg,
    zIndex: 1,
  },
  skelLine: { height: 18, borderRadius: 4, backgroundColor: lightColors.surfaceVariant },
  skelRow: { flexDirection: 'row', alignItems: 'center', marginTop: spacing.lg, gap: spacing.md },
  skelAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: lightColors.surfaceVariant,
  },
});
