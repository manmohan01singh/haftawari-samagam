import React, { useMemo, useRef, type RefObject } from 'react';
import { Pressable, StyleSheet, Text, View, type ViewStyle } from 'react-native';
import { Image } from 'expo-image';
import { MaterialIcons } from '@expo/vector-icons';
import type { NavigationContainerRef } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { YouTubePlayer, type YouTubePlayerHandle } from './YouTubePlayer';
import { HostedWatchPlayer, type HostedPlayerHandle } from './HostedWatchPlayer';
import { usePlaybackStore } from '../../features/playback/playbackStore';
import { layout, useTheme, type ThemeColors } from '../../theme';
import type { RootStackParamList } from '../../navigation/types';

/**
 * Phase E — the persistent player host. This component mounts ONCE
 * at the app root (inside NavigationContainer, above the navigator)
 * and owns the ONLY Watch player instance:
 *
 * - mode 'full': the player is positioned exactly over the Watch
 *   page's measured slot (store.slotRect), so it looks and behaves
 *   exactly as the in-screen player always did — but it is not
 *   inside the screen.
 * - mode 'mini', YouTube: Google's embed rules require a ≥200×200
 *   viewport, so the embed is PARKED at 356×200 off-screen (still
 *   mounted, still playing — never unmounted, so no reload and the
 *   position survives), and the visible surface is YouTube's mini
 *   bar: thumbnail, title, play/pause (driven through the IFrame
 *   API), close.
 * - mode 'mini', hosted: expo-video has no minimum size, so the
 *   real video shrinks into a small floating view (bottom-right)
 *   with expand/close — a true picture mini.
 *
 * Closing unmounts the player (playback stops, as YouTube's X
 * does). Session watches never come here — they keep their own
 * in-screen player with presence/chat/sync.
 */

const BAR_HIDDEN_ROUTES = new Set(['SessionWatch', 'Admin', 'SignIn', 'SignUp']);

export function PlaybackHost({
  navigationRef,
}: {
  navigationRef: RefObject<NavigationContainerRef<RootStackParamList> | null>;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const insets = useSafeAreaInsets();

  const item = usePlaybackStore((s) => s.item);
  const mode = usePlaybackStore((s) => s.mode);
  const playing = usePlaybackStore((s) => s.playing);
  const slotRect = usePlaybackStore((s) => s.slotRect);
  const routeName = usePlaybackStore((s) => s.routeName);
  const setPlaying = usePlaybackStore((s) => s.setPlaying);
  const expand = usePlaybackStore((s) => s.expand);
  const close = usePlaybackStore((s) => s.close);

  const ytRef = useRef<YouTubePlayerHandle>(null);
  const hostedRef = useRef<HostedPlayerHandle>(null);

  if (!item || mode === 'closed') return null;

  const isWatchRoute = routeName === 'Watch';
  const fullVisible =
    mode === 'full' && isWatchRoute && slotRect != null && slotRect.key === item.key;
  const barHidden =
    routeName != null && (BAR_HIDDEN_ROUTES.has(routeName) || routeName.startsWith('Admin'));
  const showBar = mode === 'mini' && !barHidden;
  const bottomOffset = layout.bottomNavHeight + Math.max(insets.bottom, 12) + 8;

  const togglePlay = () => {
    if (item.kind === 'youtube') {
      if (playing) ytRef.current?.pause();
      else ytRef.current?.play();
    } else {
      if (playing) hostedRef.current?.pause();
      else hostedRef.current?.play();
    }
    // Native YouTube reports no state back; follow the command so
    // the icon stays truthful to what the bar last asked for. Web
    // corrects this immediately with the embed's real state.
    setPlaying(!playing);
  };

  const expandToWatch = () => {
    expand();
    navigationRef.current?.navigate('Watch', {
      videoRowId: item.videoRowId ?? undefined,
      youtubeVideoId: item.youtubeVideoId ?? undefined,
    });
  };

  // Player placement ------------------------------------------------
  let playerStyle: ViewStyle;
  if (fullVisible && slotRect) {
    playerStyle = {
      position: 'absolute',
      left: slotRect.x,
      top: slotRect.y,
      width: slotRect.width,
      height: slotRect.height,
    };
  } else if (mode === 'mini' && item.kind === 'hosted') {
    // Floating mini: 168 wide, 16:9 → ~94.5 tall.
    playerStyle = {
      position: 'absolute',
      right: 12,
      bottom: bottomOffset + 8,
      width: 168,
      height: 168 / layout.thumbnailAspectRatio,
      borderRadius: 8,
      overflow: 'hidden',
    };
  } else {
    // Parked: YouTube embed keeps its ≥200-tall viewport (356×200
    // at 16:9), mounted and playing, far off-screen. Also used for
    // 'full' before the Watch slot has measured.
    playerStyle = {
      position: 'absolute',
      left: -2000,
      top: 0,
      width: 356,
      height: 200,
      overflow: 'hidden',
    };
  }

  return (
    <>
      <View style={playerStyle} pointerEvents={fullVisible || (mode === 'mini' && item.kind === 'hosted') ? 'auto' : 'none'}>
        {item.kind === 'youtube' && item.youtubeVideoId ? (
          <YouTubePlayer
            ref={ytRef}
            youtubeVideoId={item.youtubeVideoId}
            onPlayingChange={setPlaying}
          />
        ) : item.kind === 'hosted' && item.videoRowId ? (
          <HostedWatchPlayer
            ref={hostedRef}
            videoId={item.videoRowId}
            thumbnailUrl={item.thumbnailUrl}
            mini={mode === 'mini'}
            onPlayingChange={setPlaying}
          />
        ) : null}
        {mode === 'mini' && item.kind === 'hosted' ? (
          // The floating mini itself is the expand target; touches
          // pass through the player surface to this layer.
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={expandToWatch}
            accessibilityRole="button"
            accessibilityLabel="Expand player"
          />
        ) : null}
      </View>

      {mode === 'mini' && item.kind === 'hosted' ? (
        <Pressable
          style={[styles.miniClose, { bottom: bottomOffset + 8 + 168 / layout.thumbnailAspectRatio - 30, right: 18 }]}
          onPress={close}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Close player"
        >
          <MaterialIcons name="close" size={16} color="#FFFFFF" />
        </Pressable>
      ) : null}

      {showBar && item.kind === 'youtube' ? (
        <View style={[styles.bar, { bottom: bottomOffset }]}>
          <Pressable style={styles.barMain} onPress={expandToWatch} accessibilityRole="button" accessibilityLabel="Expand player">
            {item.thumbnailUrl ? (
              <Image
                source={{ uri: item.thumbnailUrl }}
                style={styles.barThumb}
                contentFit="cover"
                cachePolicy="memory-disk"
              />
            ) : (
              <View style={[styles.barThumb, styles.barThumbEmpty]}>
                <Image
                  source={require('../../../assets/icon.png')}
                  style={styles.barThumbMark}
                  contentFit="contain"
                />
              </View>
            )}
            <View style={styles.barText}>
              <Text style={styles.barTitle} numberOfLines={1} ellipsizeMode="tail">
                {item.title}
              </Text>
              <Text style={styles.barChannel} numberOfLines={1} ellipsizeMode="tail">
                {item.channelLine}
              </Text>
            </View>
          </Pressable>
          <Pressable
            style={styles.barButton}
            onPress={togglePlay}
            hitSlop={6}
            accessibilityRole="button"
            accessibilityLabel={playing ? 'Pause' : 'Play'}
          >
            <MaterialIcons name={playing ? 'pause' : 'play-arrow'} size={26} color={colors.text} />
          </Pressable>
          <Pressable
            style={styles.barButton}
            onPress={close}
            hitSlop={6}
            accessibilityRole="button"
            accessibilityLabel="Close player"
          >
            <MaterialIcons name="close" size={22} color={colors.text} />
          </Pressable>
        </View>
      ) : null}
    </>
  );
}

const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    bar: {
      position: 'absolute',
      left: 8,
      right: 8,
      height: 56,
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.surface,
      borderRadius: 8,
      paddingLeft: 6,
      paddingRight: 4,
      shadowColor: '#000000',
      shadowOpacity: 0.25,
      shadowRadius: 8,
      shadowOffset: { width: 0, height: 2 },
      elevation: 6,
    },
    barMain: { flex: 1, flexDirection: 'row', alignItems: 'center', minWidth: 0 },
    barThumb: { width: 80, height: 45, borderRadius: 4, backgroundColor: colors.playerBackground },
    barThumbEmpty: { alignItems: 'center', justifyContent: 'center' },
    barThumbMark: { width: 28, height: 28 },
    barText: { flex: 1, marginLeft: 10, minWidth: 0 },
    barTitle: { fontSize: 13, lineHeight: 17, fontWeight: '500', color: colors.text },
    barChannel: { fontSize: 11, lineHeight: 14, color: colors.textSecondary, marginTop: 1 },
    barButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
    miniClose: {
      position: 'absolute',
      width: 24,
      height: 24,
      borderRadius: 12,
      backgroundColor: 'rgba(0,0,0,0.65)',
      alignItems: 'center',
      justifyContent: 'center',
    },
  });
