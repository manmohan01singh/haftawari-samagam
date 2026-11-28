import React, { useMemo, useRef, useState, type RefObject } from 'react';
import { Pressable, StyleSheet, View, type ViewStyle } from 'react-native';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
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
 *   viewport, so the embed itself stays 200×200 — but measured on
 *   the live app (28 Nov 2026) the 16:9 picture is TOP-anchored in
 *   that viewport and the bottom ~43% is pure black void, which
 *   the user rightly called broken ('mini player thalle black
 *   black kyun hai'). The visible card is therefore a 200×113
 *   window (overflow hidden) over the embed's top: exactly the
 *   picture, no void, with the REAL embed still playing inside.
 *   Overlay controls: tap the card to expand back to Watch,
 *   play/pause bottom-left, close top-right. On routes where the
 *   mini must not show (a session watch, admin, auth) the embed
 *   parks at 356×200 off-screen instead — still mounted, still
 *   playing, position preserved.
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
  const watchKind = usePlaybackStore((s) => s.watchKind);
  const setPlaying = usePlaybackStore((s) => s.setPlaying);
  const expand = usePlaybackStore((s) => s.expand);
  const close = usePlaybackStore((s) => s.close);

  const ytRef = useRef<YouTubePlayerHandle>(null);
  const hostedRef = useRef<HostedPlayerHandle>(null);
  // Which hosted item has a loaded, controllable player. The
  // floating mini only offers play/pause once this matches — before
  // that (URL still minting, or the signed-out gate) a transport
  // button would promise control it cannot deliver.
  const [hostedReadyKey, setHostedReadyKey] = useState<string | null>(null);

  if (!item || mode === 'closed') return null;

  const isWatchRoute = routeName === 'Watch';
  const fullVisible =
    mode === 'full' &&
    isWatchRoute &&
    watchKind === 'plain' &&
    slotRect != null &&
    slotRect.key === item.key;
  const barHidden =
    (routeName != null && (BAR_HIDDEN_ROUTES.has(routeName) || routeName.startsWith('Admin'))) ||
    (isWatchRoute && watchKind === 'session');
  const miniCardVisible = mode === 'mini' && item.kind === 'youtube' && !barHidden;
  const hostedMiniVisible = mode === 'mini' && item.kind === 'hosted' && !barHidden;
  const playerVisible = fullVisible || miniCardVisible || hostedMiniVisible;

  // NEVER hidden-but-playing (Chat 2 fault 19, 28 Nov 2026 — the
  // worst-five): when the player is parked off-screen (a route
  // where no mini may show, or a Back that left the store in 'full'
  // with no slot), it must be PAUSED. A YouTube iframe playing
  // invisibly is both a user trap (sound with no stop control) and
  // a YouTube policy violation (background players, III.I.9). The
  // listener fires on every visibility change; pausing an already
  // paused player is a no-op.
  React.useEffect(() => {
    if (playerVisible) return;
    if (item.kind === 'youtube') ytRef.current?.pause();
    else hostedRef.current?.pause();
    setPlaying(false);
  }, [playerVisible, mode, item.kind, setPlaying]);
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
      // Belt-and-braces clip at the slot itself: nothing the player
      // renders may ever paint over the sheet below it.
      overflow: 'hidden',
    };
  } else if (hostedMiniVisible) {
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
  } else if (miniCardVisible) {
    // The YouTube mini card: a 200×113 window over the 200×200
    // embed (see the header note) — the picture fills the card,
    // the black void below the picture is cropped away.
    playerStyle = {
      position: 'absolute',
      right: 8,
      bottom: bottomOffset + 8,
      width: 200,
      height: 113,
      borderRadius: 12,
      overflow: 'hidden',
      backgroundColor: '#000000',
      shadowColor: '#000000',
      shadowOpacity: 0.35,
      shadowRadius: 10,
      shadowOffset: { width: 0, height: 4 },
      elevation: 8,
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
      <View style={playerStyle} pointerEvents={playerVisible ? 'auto' : 'none'}>
        <View style={miniCardVisible ? styles.miniStage : styles.stageFill}>
          {item.kind === 'youtube' && item.youtubeVideoId ? (
            <YouTubePlayer
              ref={ytRef}
              youtubeVideoId={item.youtubeVideoId}
              autoplay
              onPlayingChange={setPlaying}
            />
          ) : item.kind === 'hosted' && item.videoRowId ? (
            <HostedWatchPlayer
              ref={hostedRef}
              videoId={item.videoRowId}
              thumbnailUrl={item.thumbnailUrl}
              mini={mode === 'mini'}
              onPlayingChange={setPlaying}
              onReady={() => setHostedReadyKey(item.key)}
            />
          ) : null}
        </View>
        {hostedMiniVisible ? (
          // The floating mini itself is the expand target; touches
          // pass through the player surface to this layer.
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={expandToWatch}
            accessibilityRole="button"
            accessibilityLabel="Expand player"
          />
        ) : null}
        {miniCardVisible ? (
          // The card body expands; the two corner buttons ride
          // above it (rendered after = on top). The embed under the
          // overlay never sees mini-mode taps, same bargain as the
          // hosted mini.
          <>
            <Pressable
              style={StyleSheet.absoluteFill}
              onPress={expandToWatch}
              accessibilityRole="button"
              accessibilityLabel="Expand player"
            />
            <Pressable
              style={[styles.miniClose, styles.miniCardClose]}
              onPress={close}
              hitSlop={12}
              accessibilityRole="button"
              accessibilityLabel="Close player"
            >
              <MaterialIcons name="close" size={16} color="#FFFFFF" />
            </Pressable>
            <Pressable
              style={[styles.miniClose, styles.miniCardPlay]}
              onPress={togglePlay}
              hitSlop={12}
              accessibilityRole="button"
              accessibilityLabel={playing ? 'Pause' : 'Play'}
            >
              <MaterialIcons name={playing ? 'pause' : 'play-arrow'} size={16} color="#FFFFFF" />
            </Pressable>
          </>
        ) : null}
      </View>

      {hostedMiniVisible ? (
        <Pressable
          style={[styles.miniClose, { bottom: bottomOffset + 8 + 168 / layout.thumbnailAspectRatio - 30, right: 18 }]}
          onPress={close}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="Close player"
        >
          <MaterialIcons name="close" size={16} color="#FFFFFF" />
        </Pressable>
      ) : null}

      {hostedMiniVisible && hostedReadyKey === item.key ? (
        <Pressable
          style={[styles.miniClose, { bottom: bottomOffset + 14, right: 18 }]}
          onPress={togglePlay}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel={playing ? 'Pause' : 'Play'}
        >
          <MaterialIcons name={playing ? 'pause' : 'play-arrow'} size={16} color="#FFFFFF" />
        </Pressable>
      ) : null}

    </>
  );
}

const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    // Mini-card stage: the embed keeps its full 200×200 viewport
    // inside the 200×113 card window (top-anchored; the card clips
    // the black void). Every other mode: fill the placement box.
    miniStage: { width: 200, height: 200 },
    stageFill: { flex: 1 },
    miniCardClose: { position: 'absolute', top: 6, right: 6 },
    miniCardPlay: { position: 'absolute', left: 6, bottom: 6 },
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
