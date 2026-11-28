import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  Share,
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
import { layout, spacing, useTheme, type ThemeColors } from '../../theme';
import type { MainTabParamList, RootStackParamList } from '../../navigation/types';

/** Minimal structural shape of FlatList's viewability callback. */
interface ViewableInfo {
  viewableItems: { index?: number | null }[];
}

type Props = BottomTabScreenProps<MainTabParamList, 'Shorts'>;

const VIEWABILITY_CONFIG = { itemVisiblePercentThreshold: 60 };

/**
 * Shorts (user, 28 Nov 2026): a full-screen vertical pager of short
 * videos from the app's OWN channels only (see shortsFeed). Each
 * page is the official YouTube embed — playback, branding and
 * controls are YouTube's, untouched. Only the active page and its
 * immediate neighbours mount a player; the rest show their poster.
 * Leaving the tab pauses playback (the tab navigator freezes the
 * screen, which would otherwise leave audio running invisibly).
 */
export function ShortsScreen({ navigation }: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const isFocused = useIsFocused();

  const [items, setItems] = useState<ShortItem[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [itemH, setItemH] = useState(0);
  const [activeIndex, setActiveIndex] = useState(0);
  const [userPaused, setUserPaused] = useState(false);

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
          setItems(shorts);
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

  const onViewableItemsChanged = useCallback(
    ({ viewableItems }: ViewableInfo) => {
      const first = viewableItems[0];
      if (first && typeof first.index === 'number' && first.index !== activeIndexRef.current) {
        playerRefs.current.get(activeIndexRef.current)?.pause();
        setUserPaused(false);
        setActiveIndex(first.index);
      }
    },
    [],
  );
  const viewabilityConfig = VIEWABILITY_CONFIG;

  const openRoot = useCallback(
    (route: 'Watch' | 'Channel', params: Record<string, string>) => {
      const parent = navigation.getParent<NavigationProp<RootStackParamList>>();
      if (route === 'Watch') parent?.navigate('Watch', { youtubeVideoId: params.youtubeVideoId });
      else parent?.navigate('Channel', { channelId: params.channelId });
    },
    [navigation],
  );

  const renderItem = useCallback(
    ({ item, index }: { item: ShortItem; index: number }) => {
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

          {/* Tap layer: play/pause the active short (inactive pages
              are aligned by the pager, so taps only land here). */}
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

          {/* Bottom overlay: channel + title at the left, actions
              at the right — YouTube Shorts' layout. */}
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
            </View>
            <View style={styles.rail}>
              <Pressable
                style={styles.railButton}
                onPress={() =>
                  void Share.share({
                    message: `https://youtu.be/${item.meta.youtubeVideoId}`,
                  }).catch(() => undefined)
                }
                accessibilityRole="button"
                accessibilityLabel="Share this Short"
              >
                <MaterialIcons name="share" size={26} color="#FFFFFF" />
                <Text style={styles.railLabel}>Share</Text>
              </Pressable>
              <Pressable
                style={styles.railButton}
                onPress={() => openRoot('Watch', { youtubeVideoId: item.meta.youtubeVideoId })}
                accessibilityRole="button"
                accessibilityLabel="Open in the full player"
              >
                <MaterialIcons name="open-in-full" size={24} color="#FFFFFF" />
                <Text style={styles.railLabel}>Open</Text>
              </Pressable>
            </View>
          </View>
        </View>
      );
    },
    [activeIndex, itemH, userPaused, openRoot, styles],
  );

  return (
    <View
      style={styles.root}
      onLayout={(e) => setItemH(e.nativeEvent.layout.height)}
    >
      {items === null && !failed ? (
        <View style={styles.stateWrap}>
          <ActivityIndicator color="#FFFFFF" />
          <Text style={styles.stateText}>Loading Shorts…</Text>
        </View>
      ) : failed || !items || items.length === 0 ? (
        <View style={styles.stateWrap}>
          <Text style={styles.stateTitle}>
            {failed ? 'Shorts could not load' : 'No Shorts yet'}
          </Text>
          <Text style={styles.stateText}>
            {failed
              ? 'Please check your connection and try again.'
              : 'None of the sangat channels have posted a Short recently.'}
          </Text>
          <Pressable
            style={styles.retryButton}
            onPress={() => {
              setItems(null);
              setFailed(false);
              setReloadKey((k) => k + 1);
            }}
            accessibilityRole="button"
          >
            <Text style={styles.retryText}>Try again</Text>
          </Pressable>
        </View>
      ) : itemH > 0 ? (
        <FlatList
          data={items}
          keyExtractor={(item) => item.meta.youtubeVideoId}
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
        />
      ) : null}
    </View>
  );
}

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
    rail: { alignItems: 'center', gap: spacing.lg },
    railButton: { alignItems: 'center', gap: 2, minWidth: 48, minHeight: 48, justifyContent: 'center' },
    railLabel: { color: '#FFFFFF', fontSize: 11, fontWeight: '500' },
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
