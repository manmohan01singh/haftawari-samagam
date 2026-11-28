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
import { useIsFocused, type NavigationProp } from '@react-navigation/native';
import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';

import { YouTubePlayer, type YouTubePlayerHandle } from '../../components/video/YouTubePlayer';
import { fetchShorts, type ShortItem } from '../../features/shorts/shortsFeed';
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
}

/**
 * The right-hand rail — YouTube Shorts' control stack, with REAL
 * app data: Like and Comments are the app's own persisted
 * engagement for this video (the same tables as the Watch page),
 * Share sends the app's deep link, Open goes to the full Watch
 * page. Counts render only when the backend returned them.
 */
function ShortRail({ item, onOpenFull, onSignIn }: RailProps) {
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
            onSignIn();
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

  const playerRefs = useRef(new Map<number, YouTubePlayerHandle>());
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

  // Focus/active choreography: exactly one short plays — the
  // visible one, on the focused tab, unless the viewer paused it.
  useEffect(() => {
    if (!isFocused) {
      playerRefs.current.get(activeIndexRef.current)?.pause();
      return;
    }
    if (!userPaused) playActive();
  }, [isFocused, activeIndex, userPaused, playActive]);

  const onViewableItemsChanged = useCallback(({ viewableItems }: ViewableInfo) => {
    const first = viewableItems[0];
    if (first && typeof first.index === 'number' && first.index !== activeIndexRef.current) {
      playerRefs.current.get(activeIndexRef.current)?.pause();
      setUserPaused(false);
      setActiveIndex(first.index);
    }
  }, []);
  const viewabilityConfig = VIEWABILITY_CONFIG;

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
                ref={(h) => {
                  if (h) playerRefs.current.set(index, h);
                  else playerRefs.current.delete(index);
                }}
                youtubeVideoId={item.meta.youtubeVideoId}
                fill
                loop
                onReady={() => {
                  if (index === activeIndexRef.current && focusedRef.current && !userPausedRef.current) {
                    playerRefs.current.get(index)?.play();
                  }
                }}
              />
            </View>
          ) : item.meta.thumbnailUrl ? (
            <Image
              source={{ uri: item.meta.thumbnailUrl }}
              style={StyleSheet.absoluteFill}
              contentFit="cover"
              cachePolicy="memory-disk"
            />
          ) : null}

          {/* Tap layer: play/pause the active short. */}
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={() => {
              if (!isActive) return;
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
                {item.meta.viewCount != null ? `${formatCount(item.meta.viewCount)} views` : ''}
                {item.meta.viewCount != null ? ' · ' : ''}
                {timeAgo(item.meta.publishedAt)}
              </Text>
            </View>
            {isActive ? (
              <ShortRail
                item={item}
                onOpenFull={() => openRoot('Watch', { youtubeVideoId: item.meta.youtubeVideoId })}
                onSignIn={() => openRoot('SignIn')}
              />
            ) : null}
          </View>
        </View>
      );
    },
    [activeIndex, itemH, userPaused, openRoot, styles],
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
