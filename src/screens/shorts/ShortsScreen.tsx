import { RequireAuthSheet } from '../../components/common/RequireAuthSheet';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Image } from 'expo-image';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useIsFocused, type NavigationProp } from '@react-navigation/native';
import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';

import { YouTubePlayer, type YouTubePlayerHandle } from '../../components/video/YouTubePlayer';
import { fetchShorts, type ShortItem } from '../../features/shorts/shortsFeed';
import { usePreferencesStore } from '../../features/settings/preferencesStore';
import { useCurrentChatUser } from '../../features/chat/useSessionChat';
import { useVideoEngagement } from '../../features/watch/useVideoEngagement';
import { VideoCommentsSheet } from '../../features/watch/components/VideoCommentsSheet';
import { formatCount, timeAgo } from '../../lib/format';
import { shareContent } from '../../lib/share';
import { watchShareUrl } from '../../navigation/linking';
import { layout, spacing, useTheme, type ThemeColors } from '../../theme';
import type { MainTabParamList, RootStackParamList } from '../../navigation/types';

/** Minimal structural shape of FlatList's viewability callback. */
interface ViewableInfo {
  viewableItems: { index?: number | null }[];
}

type Props = BottomTabScreenProps<MainTabParamList, 'Shorts'>;

const VIEWABILITY_CONFIG = { itemVisiblePercentThreshold: 60 };
/** The pool loops this many times before the feed stops growing —
 *  with ~60 shorts per pass that is effectively endless. */
const MAX_CYCLES = 30;

interface RailProps {
  item: ShortItem;
  onOpenFull: () => void;
  onSignIn: () => void;
  onRequireAuth: (action: string) => void;
}

/**
 * The right-hand rail — YouTube Shorts' control stack, with REAL
 * app data: Like and Comments are the app's own persisted
 * engagement for this video (the same tables as the Watch page),
 * Share sends the app's deep link, Open goes to the full Watch
 * page. Counts render only when the backend returned them.
 */
function ShortRail({ item, onOpenFull, onSignIn, onRequireAuth }: RailProps) {
  const { user } = useCurrentChatUser();
  const engagement = useVideoEngagement(
    item.meta.youtubeVideoId,
    null,
    user ? { id: user.id, displayName: user.displayName } : null,
  );
  const [commentsOpen, setCommentsOpen] = useState(false);
  const { colors } = useTheme();
  const styles = useMemo(() => createRailStyles(colors), [colors]);

  return (
    <View style={styles.rail}>
      <Pressable
        style={styles.railButton}
        onPress={() => {
          if (!user) {
            onRequireAuth('like this samagam');
            return;
          }
          void engagement.toggleLike();
        }}
        accessibilityRole="button"
        accessibilityLabel={engagement.likedByMe ? 'Unlike this Short' : 'Like this Short'}
      >
        <MaterialIcons
          name={engagement.likedByMe ? 'thumb-up' : 'thumb-up-off-alt'}
          size={26}
          color="#FFFFFF"
        />
        <Text style={styles.railLabel}>
          {engagement.likeStatus === 'ready' ? formatCount(engagement.likeCount) : 'Like'}
        </Text>
      </Pressable>
      <Pressable
        style={styles.railButton}
        onPress={() => setCommentsOpen(true)}
        accessibilityRole="button"
        accessibilityLabel="Open comments"
      >
        <MaterialIcons name="mode-comment" size={25} color="#FFFFFF" />
        <Text style={styles.railLabel}>
          {engagement.commentCount != null ? formatCount(engagement.commentCount) : 'Comments'}
        </Text>
      </Pressable>
      <Pressable
        style={styles.railButton}
        onPress={() =>
          void shareContent(item.meta.title, watchShareUrl({ youtubeVideoId: item.meta.youtubeVideoId }))
        }
        accessibilityRole="button"
        accessibilityLabel="Share this Short"
      >
        <MaterialIcons name="share" size={26} color="#FFFFFF" />
        <Text style={styles.railLabel}>Share</Text>
      </Pressable>
      <Pressable
        style={styles.railButton}
        onPress={onOpenFull}
        accessibilityRole="button"
        accessibilityLabel="Open in the full player"
      >
        <MaterialIcons name="open-in-full" size={24} color="#FFFFFF" />
        <Text style={styles.railLabel}>Open</Text>
      </Pressable>

      <Modal
        visible={commentsOpen}
        animationType="slide"
        transparent
        onRequestClose={() => setCommentsOpen(false)}
      >
        <View style={styles.sheetBackdrop}>
          <Pressable
            style={styles.sheetBackdropTap}
            onPress={() => setCommentsOpen(false)}
            accessibilityLabel="Close comments"
            accessibilityRole="button"
          />
          <View style={styles.sheetHost}>
            <VideoCommentsSheet
              engagement={engagement}
              user={
                user
                  ? { id: user.id, displayName: user.displayName, avatarUrl: user.avatarUrl ?? null }
                  : null
              }
              onClose={() => setCommentsOpen(false)}
              onSignInPress={() => {
                setCommentsOpen(false);
                onSignIn();
              }}
            />
          </View>
        </View>
      </Modal>
    </View>
  );
}

/**
 * Shorts (user, 28 Nov 2026): a full-screen vertical pager of short
 * videos from the app's OWN channels only (see shortsFeed). The
 * player fills the whole screen (the embed's fill mode — a Short
 * never sits in a 16:9 letterbox) and loops. Only the active page
 * and its immediate neighbours mount a player; the rest show their
 * poster. Leaving the tab pauses playback (the tab navigator
 * freezes the screen, which would otherwise leave audio running
 * invisibly). The pool loops, so the feed never runs out.
 */
export function ShortsScreen({ navigation }: Props) {
  const [authAction, setAuthAction] = useState<string | null>(null);
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const isFocused = useIsFocused();

  const [pool, setPool] = useState<ShortItem[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [cycles, setCycles] = useState(1);
  const [itemH, setItemH] = useState(0);
  const [activeIndex, setActiveIndex] = useState(0);
  const [userPaused, setUserPaused] = useState(false);
  // Muted-autoplay pattern (blueprint round 2, fault 22): browsers
  // block UNMUTED autoplay, so Shorts start muted (the embed plays
  // immediately, no black 0:00 frame) and the first interaction
  // anywhere unlocks sound for the rest of the session. The poster
  // facade covers the player until it reports actually playing, so
  // a blocked start shows the thumbnail — never a black screen.
  const autoplayEnabled = usePreferencesStore((s) => s.autoplay);
  const [soundOn, setSoundOn] = useState(false);
  const soundOnRef = useRef(false);
  const [playingIndex, setPlayingIndex] = useState(-1);

  const items = useMemo(() => {
    if (!pool) return null;
    const out: { item: ShortItem; key: string }[] = [];
    for (let c = 0; c < cycles; c++) {
      // Rotate each cycle's start (audit P2, 28 Nov 2026): repeating
      // the pool verbatim made the pool's last and first items meet
      // at every seam — when both were the same channel, the feed
      // ran one channel twice in a row, breaking the user's
      // never-one-channel-in-a-block rule at each loop boundary.
      const offset = pool.length > 1 ? c % pool.length : 0;
      const rotated =
        offset === 0 ? pool : [...pool.slice(offset), ...pool.slice(0, offset)];
      for (const item of rotated) out.push({ item, key: `${c}:${item.meta.youtubeVideoId}` });
    }
    return out;
  }, [pool, cycles]);
  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  const playerRefs = useRef(new Map<number, YouTubePlayerHandle>());
  const listRef = useRef<FlatList>(null);
  const itemsRef = useRef<{ item: ShortItem; key: string }[] | null>(null);
  const activeIndexRef = useRef(0);
  const userPausedRef = useRef(false);
  const focusedRef = useRef(isFocused);
  useEffect(() => {
    activeIndexRef.current = activeIndex;
  }, [activeIndex]);
  useEffect(() => {
    userPausedRef.current = userPaused;
  }, [userPaused]);
  useEffect(() => {
    focusedRef.current = isFocused;
  }, [isFocused]);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const shorts = await fetchShorts();
        if (active) {
          setPool(shorts);
          setFailed(false);
        }
      } catch {
        if (active) setFailed(true);
      }
    })();
    return () => {
      active = false;
    };
  }, [reloadKey]);

  const playActive = useCallback(() => {
    playerRefs.current.get(activeIndexRef.current)?.play();
  }, []);

  const unlockSound = useCallback(() => {
    if (soundOnRef.current) return;
    soundOnRef.current = true;
    setSoundOn(true);
    playerRefs.current.get(activeIndexRef.current)?.setMuted(false);
  }, []);

  // Focus/active choreography: exactly one short plays — the
  // visible one, on the focused tab, unless the viewer paused it.
  // The Autoplay preference gates this too (fix round 4, B1): with
  // autoplay OFF the effect used to command play() anyway, making
  // the Settings toggle a no-op — a Short may then start only from
  // the viewer's own tap.
  useEffect(() => {
    if (!isFocused) {
      playerRefs.current.get(activeIndexRef.current)?.pause();
      return;
    }
    if (!userPaused && autoplayEnabled) playActive();
  }, [isFocused, activeIndex, userPaused, playActive, autoplayEnabled]);

  const onViewableItemsChanged = useCallback(({ viewableItems }: ViewableInfo) => {
    const first = viewableItems[0];
    if (first && typeof first.index === 'number' && first.index !== activeIndexRef.current) {
      playerRefs.current.get(activeIndexRef.current)?.pause();
      setUserPaused(false);
      setActiveIndex(first.index);
    }
  }, []);
  const viewabilityConfig = VIEWABILITY_CONFIG;

  // Desktop navigation (Chat 2 fault 21, 28 Nov 2026): on a
  // computer there is no touch swipe, the mouse wheel lands inside
  // the YouTube iframe, and the embed's own Next is disabled — so
  // without app controls only the first Short was reachable. The
  // chevron buttons (rendered by the return below) and these keys
  // give desktop a real path; phones keep the swipe.
  const goToShort = useCallback(
    (index: number) => {
      const count = itemsRef.current?.length ?? 0;
      if (count === 0) return;
      const next = Math.max(0, Math.min(count - 1, index));
      listRef.current?.scrollToIndex({ index: next, animated: true });
    },
    [],
  );

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown' || e.key === 'PageDown' || e.key === 'j') {
        e.preventDefault();
        goToShort(activeIndexRef.current + 1);
      } else if (e.key === 'ArrowUp' || e.key === 'PageUp' || e.key === 'k') {
        e.preventDefault();
        goToShort(activeIndexRef.current - 1);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [goToShort]);

  const openRoot = useCallback(
    (route: 'Watch' | 'Channel' | 'SignIn', params?: Record<string, string>) => {
      const parent = navigation.getParent<NavigationProp<RootStackParamList>>();
      if (route === 'Watch') parent?.navigate('Watch', { youtubeVideoId: params?.youtubeVideoId });
      else if (route === 'Channel') parent?.navigate('Channel', { channelId: params?.channelId });
      else parent?.navigate('SignIn');
    },
    [navigation],
  );

  const renderItem = useCallback(
    ({ item: entry, index }: { item: { item: ShortItem; key: string }; index: number }) => {
      const item = entry.item;
      const mounted = Math.abs(index - activeIndex) <= 1;
      const isActive = index === activeIndex;
      return (
        <View style={[styles.page, { height: itemH }]}>
          {mounted ? (
            <View style={StyleSheet.absoluteFill}>
              <YouTubePlayer
                key={item.meta.youtubeVideoId}
                ref={(h) => {
                  if (h) playerRefs.current.set(index, h);
                  else playerRefs.current.delete(index);
                }}
                youtubeVideoId={item.meta.youtubeVideoId}
                fill
                loop
                autoplay={isActive && autoplayEnabled}
                muted={!soundOn}
                onReady={() => {
                  if (index === activeIndexRef.current && focusedRef.current && !userPausedRef.current && autoplayEnabled) {
                    playerRefs.current.get(index)?.play();
                    if (soundOnRef.current) playerRefs.current.get(index)?.setMuted(false);
                  }
                }}
                onPlayingChange={(playing) => {
                  if (playing && index === activeIndexRef.current) setPlayingIndex(index);
                }}
              />
              {/* Facade until this page is REALLY playing (fault
                  22): the poster, not a black frame. Keyed player +
                  this overlay living outside the rail's subtree is
                  also the fault-24 separation: opening comments
                  re-renders the rail only, never this player. */}
              {isActive && playingIndex !== index && item.meta.thumbnailUrl ? (
                <Image
                  source={{ uri: item.meta.thumbnailUrl }}
                  style={StyleSheet.absoluteFill}
                  contentFit="cover"
                  cachePolicy="memory-disk"
                  pointerEvents="none"
                />
              ) : null}
            </View>
          ) : item.meta.thumbnailUrl ? (
            <Image
              source={{ uri: item.meta.thumbnailUrl }}
              style={StyleSheet.absoluteFill}
              contentFit="cover"
              cachePolicy="memory-disk"
            />
          ) : null}

          {/* Tap layer: play/pause the active short. Any tap is
              also the sound unlock (fault 22): after the first
              interaction the session runs unmuted. */}
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={() => {
              if (!isActive) return;
              unlockSound();
              if (userPaused) {
                setUserPaused(false);
                playerRefs.current.get(index)?.play();
              } else {
                setUserPaused(true);
                playerRefs.current.get(index)?.pause();
              }
            }}
            accessibilityRole="button"
            accessibilityLabel={userPaused ? 'Play' : 'Pause'}
          />
          {isActive && !soundOn && playingIndex === index ? (
            <Pressable
              style={styles.soundPill}
              onPress={unlockSound}
              accessibilityRole="button"
              accessibilityLabel="Tap for sound"
            >
              <MaterialIcons name="volume-off" size={16} color="#FFFFFF" />
              <Text style={styles.soundPillText}>Tap for sound</Text>
            </Pressable>
          ) : null}
          {isActive && userPaused ? (
            <View style={styles.pausedGlyph} pointerEvents="none">
              <MaterialIcons name="play-arrow" size={72} color="rgba(255,255,255,0.9)" />
            </View>
          ) : null}

          {/* Bottom overlay: channel + title + views/time at the
              left, the control rail at the right. */}
          <View style={styles.overlay} pointerEvents="box-none">
            <View style={styles.metaBlock}>
              <Pressable
                style={styles.channelRow}
                onPress={() => openRoot('Channel', { channelId: item.channelId })}
                accessibilityRole="button"
                accessibilityLabel={`View channel ${item.channelTitle}`}
              >
                {item.channelAvatarUrl ? (
                  <Image
                    source={{ uri: item.channelAvatarUrl }}
                    style={styles.channelAvatar}
                    contentFit="cover"
                    cachePolicy="memory-disk"
                  />
                ) : (
                  <View style={[styles.channelAvatar, styles.avatarFallback]}>
                    <Text style={styles.avatarInitial}>
                      {item.channelTitle.charAt(0).toUpperCase()}
                    </Text>
                  </View>
                )}
                <Text style={styles.channelName} numberOfLines={1}>
                  {item.channelTitle}
                </Text>
              </Pressable>
              <Text style={styles.title} numberOfLines={2}>
                {item.meta.title}
              </Text>
              <Text style={styles.metaLine} numberOfLines={1}>
                {/* One template string (fix round 4, Chat 2 #17/N4):
                    adjacent JSX expressions lose their separating
                    spaces in the web render — "799 views·4 hr ago". */}
                {item.meta.viewCount != null
                  ? `${formatCount(item.meta.viewCount)} views · ${timeAgo(item.meta.publishedAt)}`
                  : timeAgo(item.meta.publishedAt)}
              </Text>
            </View>
            {isActive ? (
              <ShortRail
                item={item}
                onOpenFull={() => openRoot('Watch', { youtubeVideoId: item.meta.youtubeVideoId })}
                onSignIn={() => openRoot('SignIn')}
                onRequireAuth={(a) => setAuthAction(a)}
              />
            ) : null}
          </View>
        </View>
      );
    },
    [activeIndex, itemH, userPaused, openRoot, styles, soundOn, playingIndex, unlockSound, autoplayEnabled],
  );

  return (
    <View style={styles.root} onLayout={(e) => setItemH(e.nativeEvent.layout.height)}>
      {pool === null && !failed ? (
        <View style={styles.stateWrap}>
          <ActivityIndicator color="#FFFFFF" />
          <Text style={styles.stateText}>Loading Shorts…</Text>
        </View>
      ) : failed || !pool || pool.length === 0 ? (
        <View style={styles.stateWrap}>
          <Text style={styles.stateTitle}>{failed ? 'Shorts could not load' : 'No Shorts yet'}</Text>
          <Text style={styles.stateText}>
            {failed
              ? 'Please check your connection and try again.'
              : 'None of the sangat channels have posted a Short recently.'}
          </Text>
          <Pressable
            style={styles.retryButton}
            onPress={() => {
              setPool(null);
              setFailed(false);
              setReloadKey((k) => k + 1);
            }}
            accessibilityRole="button"
          >
            <Text style={styles.retryText}>Try again</Text>
          </Pressable>
        </View>
      ) : itemH > 0 && items ? (
        <FlatList
          ref={listRef}
          data={items}
          keyExtractor={(entry) => entry.key}
          renderItem={renderItem}
          pagingEnabled
          snapToInterval={itemH}
          decelerationRate="fast"
          showsVerticalScrollIndicator={false}
          onViewableItemsChanged={onViewableItemsChanged}
          viewabilityConfig={viewabilityConfig}
          getItemLayout={(_, index) => ({ length: itemH, offset: itemH * index, index })}
          windowSize={3}
          initialNumToRender={2}
          maxToRenderPerBatch={2}
          onEndReached={() => setCycles((c) => Math.min(MAX_CYCLES, c + 1))}
          onEndReachedThreshold={3}
        />
      ) : null}
      {items && items.length > 1 ? (
        <View style={styles.navButtons} pointerEvents="box-none">
          <Pressable
            style={styles.navButton}
            onPress={() => goToShort(activeIndex - 1)}
            accessibilityRole="button"
            accessibilityLabel="Previous Short"
          >
            <MaterialIcons name="keyboard-arrow-up" size={26} color="#FFFFFF" />
          </Pressable>
          <Pressable
            style={styles.navButton}
            onPress={() => goToShort(activeIndex + 1)}
            accessibilityRole="button"
            accessibilityLabel="Next Short"
          >
            <MaterialIcons name="keyboard-arrow-down" size={26} color="#FFFFFF" />
          </Pressable>
        </View>
      ) : null}
      <RequireAuthSheet
        action={authAction}
        onDismiss={() => setAuthAction(null)}
        onSignIn={() => {
          setAuthAction(null);
          openRoot('SignIn');
        }}
      />
    </View>
  );
}

const createRailStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    rail: { alignItems: 'center', gap: spacing.lg },
    railButton: { alignItems: 'center', gap: 2, minWidth: 48, minHeight: 48, justifyContent: 'center' },
    railLabel: {
      color: '#FFFFFF',
      fontSize: 11,
      fontWeight: '500',
      textShadowColor: 'rgba(0,0,0,0.6)',
      textShadowOffset: { width: 0, height: 1 },
      textShadowRadius: 3,
    },
    sheetBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
    sheetBackdropTap: { flex: 1 },
    sheetHost: { height: '72%', backgroundColor: colors.background },
  });

const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.playerBackground },
    navButtons: {
      position: 'absolute',
      left: 14,
      top: '50%',
      marginTop: -52,
      gap: 10,
    },
    navButton: {
      width: 44,
      height: 44,
      borderRadius: 22,
      backgroundColor: 'rgba(0,0,0,0.45)',
      alignItems: 'center',
      justifyContent: 'center',
    },
    page: { width: '100%', backgroundColor: colors.playerBackground, overflow: 'hidden' },
    pausedGlyph: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      alignItems: 'center',
      justifyContent: 'center',
    },
    soundPill: {
      position: 'absolute',
      top: 12,
      left: 12,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      backgroundColor: 'rgba(0,0,0,0.65)',
      borderRadius: 999,
      paddingHorizontal: 12,
      paddingVertical: 7,
    },
    soundPillText: { color: '#FFFFFF', fontSize: 12, fontWeight: '600' },
    overlay: {
      position: 'absolute',
      left: 0,
      right: 0,
      bottom: 0,
      flexDirection: 'row',
      alignItems: 'flex-end',
      paddingHorizontal: spacing.md,
      paddingBottom: layout.bottomNavHeight + spacing.xl,
      gap: spacing.md,
    },
    metaBlock: { flex: 1, minWidth: 0 },
    channelRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.sm },
    channelAvatar: { width: 32, height: 32, borderRadius: 16, backgroundColor: colors.surfaceVariant },
    avatarFallback: { alignItems: 'center', justifyContent: 'center' },
    avatarInitial: { color: '#FFFFFF', fontSize: 14, fontWeight: '700' },
    channelName: {
      color: '#FFFFFF',
      fontSize: 14,
      fontWeight: '600',
      flexShrink: 1,
      textShadowColor: 'rgba(0,0,0,0.6)',
      textShadowOffset: { width: 0, height: 1 },
      textShadowRadius: 3,
    },
    title: {
      color: '#FFFFFF',
      fontSize: 14,
      lineHeight: 19,
      textShadowColor: 'rgba(0,0,0,0.6)',
      textShadowOffset: { width: 0, height: 1 },
      textShadowRadius: 3,
    },
    metaLine: {
      color: 'rgba(255,255,255,0.85)',
      fontSize: 12,
      marginTop: 4,
      textShadowColor: 'rgba(0,0,0,0.6)',
      textShadowOffset: { width: 0, height: 1 },
      textShadowRadius: 3,
    },
    stateWrap: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: spacing.xl,
      gap: spacing.sm,
    },
    stateTitle: { color: '#FFFFFF', fontSize: 17, fontWeight: '600', textAlign: 'center' },
    stateText: { color: 'rgba(255,255,255,0.75)', fontSize: 14, textAlign: 'center' },
    retryButton: {
      marginTop: spacing.md,
      backgroundColor: '#FFFFFF',
      borderRadius: 999,
      paddingHorizontal: spacing.xl,
      minHeight: 44,
      justifyContent: 'center',
    },
    retryText: { color: '#0F0F0F', fontSize: 14, fontWeight: '600' },
  });
