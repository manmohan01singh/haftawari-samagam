import React, { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { Pressable, StyleSheet, Text, View, type ViewStyle } from 'react-native';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import type { NavigationContainerRef } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { YouTubePlayer, type YouTubePlayerHandle } from './YouTubePlayer';
import { HostedWatchPlayer, type HostedPlayerHandle } from './HostedWatchPlayer';
import { usePlaybackStore } from '../../features/playback/playbackStore';
import { usePreferencesStore } from '../../features/settings/preferencesStore';
import { useAuth } from '../../features/auth';
import { recordLocalWatch } from '../../features/library/localHistory';
import { recordWatchHistory } from '../../lib/videos';
import { layout, typography, useTheme, type ThemeColors } from '../../theme';
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
 *   Since fix round 4 the window sits in a solid DOCK strip above
 *   the bottom nav: title + channel beside the picture, play/pause
 *   and close as real buttons in the strip, tap the picture or the
 *   title to expand back to Watch. On routes where the mini must
 *   not show (a session watch, admin, auth) the embed parks at
 *   356×200 off-screen instead — and the park-pause effect pauses
 *   it there; a parked player never plays invisibly.
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

  const autoplayEnabled = usePreferencesStore((s) => s.autoplay);
  const item = usePlaybackStore((s) => s.item);
  const mode = usePlaybackStore((s) => s.mode);
  const playing = usePlaybackStore((s) => s.playing);
  const slotRect = usePlaybackStore((s) => s.slotRect);
  const routeName = usePlaybackStore((s) => s.routeName);
  const watchKind = usePlaybackStore((s) => s.watchKind);
  const setPlaying = usePlaybackStore((s) => s.setPlaying);
  const expand = usePlaybackStore((s) => s.expand);
  const close = usePlaybackStore((s) => s.close);
  const setCoveredKey = usePlaybackStore((s) => s.setCoveredKey);
  const suppressedKey = usePlaybackStore((s) => s.suppressedKey);
  const { user } = useAuth();

  const ytRef = useRef<YouTubePlayerHandle>(null);
  const hostedRef = useRef<HostedPlayerHandle>(null);
  // Which hosted item has a loaded, controllable player. The
  // floating mini only offers play/pause once this matches — before
  // that (URL still minting, or the signed-out gate) a transport
  // button would promise control it cannot deliver.
  const [hostedReadyKey, setHostedReadyKey] = useState<string | null>(null);

  // HOOKS FIRST, always (regression fix, 28 Nov 2026): the Batch A
  // parked-pause effect was placed after an early
  // `if (!item) return null`, so the first video open rendered MORE
  // hooks than the initial empty render — React threw, the host's
  // error boundary (fallback null, no auto-retry) swallowed it, and
  // the player was dead for the whole session: recorded videos sat
  // on the slot poster forever with no iframe in the DOM at all.
  // Every hook now runs unconditionally; the empty return lives
  // below them, and the derived values are null-safe.
  const isWatchRoute = routeName === 'Watch';
  const fullVisible =
    mode === 'full' &&
    isWatchRoute &&
    watchKind === 'plain' &&
    slotRect != null &&
    item != null &&
    slotRect.key === item.key;
  const barHidden =
    (routeName != null && (BAR_HIDDEN_ROUTES.has(routeName) || routeName.startsWith('Admin'))) ||
    (isWatchRoute && watchKind === 'session');
  const miniCardVisible = mode === 'mini' && item?.kind === 'youtube' && !barHidden;
  const hostedMiniVisible = mode === 'mini' && item?.kind === 'hosted' && !barHidden;
  const playerVisible = fullVisible || miniCardVisible || hostedMiniVisible;

  // VISIBLE-FIRST MOUNT (blueprint round 2, A2): a brand-new item's
  // player is not mounted at all until it can appear in its slot (or
  // mini). An embed that first loads parked at left:-2000 tries to
  // autoplay off-screen, where browsers and YouTube's own visibility
  // rules can block it permanently; an embed that first loads inside
  // its visible slot, inside the user's tap chain, plays. Once an
  // item HAS been visible, its player stays mounted (parking then
  // only hides an already-loaded player, which is safe).
  const [shownKey, setShownKey] = useState<string | null>(null);
  // React's adjust-state-during-render pattern: remember that this
  // item has been visible at least once (see A2 above).
  if (playerVisible && item && shownKey !== item.key) {
    setShownKey(item.key);
  }
  // A rescue player on the Watch screen has taken this item over:
  // the host mounts nothing for it and never park-pauses it.
  const suppressed = item != null && suppressedKey === item.key;
  const mountPlayer = item != null && !suppressed && (playerVisible || shownKey === item.key);

  // Report coverage: the Watch screen's rescue timer reads this —
  // if the host is visibly rendering the item in the slot, the
  // hand-off worked and no rescue is needed.
  useEffect(() => {
    if (item && fullVisible && mountPlayer) setCoveredKey(item.key);
  }, [item, fullVisible, mountPlayer, setCoveredKey]);

  // HISTORY (fix round 4, Chat 2 N3): the play-time accumulator
  // lives HERE, not on the Watch screen — it keeps counting while
  // the mini player plays after the Watch screen is gone, which is
  // exactly the time the old screen-owned gate never saw. 5 s of
  // real playing (buffering pauses the count, never resets it)
  // writes the local history once, and the account history once
  // when signed in and the video has a catalogue row.
  const accumRef = useRef<{ key: string; ms: number }>({ key: '', ms: 0 });
  const localDoneRef = useRef<string | null>(null);
  const serverDoneRef = useRef<string | null>(null);
  useEffect(() => {
    if (!item || !playing) return;
    const key = item.key;
    if (accumRef.current.key !== key) accumRef.current = { key, ms: 0 };
    const ytId = item.youtubeVideoId;
    const rowId = item.videoRowId;
    const localPending = ytId != null && localDoneRef.current !== key;
    const serverPending = rowId != null && user != null && serverDoneRef.current !== key;
    if (!localPending && !serverPending) return;
    let last = Date.now();
    const iv = setInterval(() => {
      const now = Date.now();
      accumRef.current.ms += now - last;
      last = now;
      if (accumRef.current.ms < 5000) return;
      clearInterval(iv);
      if (ytId && localDoneRef.current !== key) {
        localDoneRef.current = key;
        void recordLocalWatch({
          youtubeVideoId: ytId,
          videoRowId: rowId,
          channelTitle: item.channelLine || null,
          title: item.title,
          thumbnailUrl: item.thumbnailUrl,
          durationSeconds: null,
        }).catch(() => undefined);
      }
      if (rowId && user && serverDoneRef.current !== key) {
        serverDoneRef.current = key;
        void recordWatchHistory(user.id, rowId, item.channelLine || null).catch(() => undefined);
      }
    }, 500);
    return () => clearInterval(iv);
  }, [item, playing, user]);

  // NEVER hidden-but-playing (Chat 2 fault 19, 28 Nov 2026 — the
  // worst-five): when the player is parked off-screen (a route
  // where no mini may show, or a Back that left the store in 'full'
  // with no slot), it must be PAUSED. A YouTube iframe playing
  // invisibly is both a user trap (sound with no stop control) and
  // a YouTube policy violation (background players, III.I.9).
  //
  // TIMING (user report, 28 Nov 2026: "kuch vi play nahi ho
  // reha"): the first version paused INSTANTLY — but opening a
  // video passes through a brief not-visible window (the store
  // opens the item while the route is still Home and the Watch
  // slot has not measured yet), so the pause landed on every
  // legitimate open and killed autoplay. Now: bar-hidden routes
  // (SessionWatch/Admin/auth — the player can NEVER be visible
  // there) pause immediately; any other invisibility must persist
  // for 900 ms before the pause lands, which no real transition
  // takes.
  const visibleRef = useRef(playerVisible);
  const itemKind = item?.kind ?? null;
  React.useEffect(() => {
    // Keep the ref at the latest visibility inside the effect —
    // writing a ref during render is both a lint error and, in
    // concurrent rendering, a correctness smell. The 900 ms timer
    // below reads it when it fires, long after this sync ran.
    visibleRef.current = playerVisible;
    if (!item || playerVisible) return;
    // A rescue player owns this item on the Watch screen — visible
    // there, so nothing here may pause it.
    if (suppressed) return;
    const pauseNow = () => {
      if (item.kind === 'youtube') ytRef.current?.pause();
      else hostedRef.current?.pause();
      setPlaying(false);
    };
    if (barHidden) {
      pauseNow();
      return;
    }
    // On the Watch route the player belongs to that screen — its
    // slot may still be measuring, and the screen's own unmount
    // changes the route (which re-runs this effect). Never pause
    // while Watch owns the screen.
    if (isWatchRoute) return;
    const t = setTimeout(() => {
      if (!visibleRef.current) pauseNow();
    }, 900);
    return () => clearTimeout(t);
  }, [playerVisible, mode, item, itemKind, setPlaying, barHidden, isWatchRoute, suppressed]);
  const bottomOffset = layout.bottomNavHeight + Math.max(insets.bottom, 12) + 8;

  // The empty return — AFTER every hook above (see the hooks-first
  // note at the top of this component).
  if (!item || mode === 'closed') return null;

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
    // The YouTube mini sits in the left of the mini DOCK (fix
    // round 4, Chat 2 #20): a 200×113 window over the 200×200 embed
    // (see the header note) — the picture fills the window, the
    // black void below the picture is cropped away. The dock beside
    // it carries the title and the play/pause + close controls, so
    // nothing sits on the picture and the strip is docked above the
    // bottom nav instead of floating over the feed.
    playerStyle = {
      position: 'absolute',
      left: 8,
      bottom: bottomOffset,
      width: 200,
      height: 113,
      borderRadius: 8,
      overflow: 'hidden',
      backgroundColor: '#000000',
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
      {miniCardVisible ? (
        <View style={[styles.miniDock, { bottom: bottomOffset - 8 }]}>
          <View style={styles.miniDockSpacer} />
          <Pressable
            style={styles.miniDockText}
            onPress={expandToWatch}
            accessibilityRole="button"
            accessibilityLabel="Expand player"
          >
            <Text style={styles.miniDockTitle} numberOfLines={2}>
              {item.title}
            </Text>
            <Text style={styles.miniDockChannel} numberOfLines={1}>
              {item.channelLine}
            </Text>
          </Pressable>
          <Pressable
            style={styles.miniDockBtn}
            onPress={togglePlay}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={playing ? 'Pause' : 'Play'}
          >
            <MaterialIcons name={playing ? 'pause' : 'play-arrow'} size={28} color={colors.text} />
          </Pressable>
          <Pressable
            style={styles.miniDockBtn}
            onPress={close}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Close player"
          >
            <MaterialIcons name="close" size={24} color={colors.text} />
          </Pressable>
        </View>
      ) : null}
      <View style={playerStyle} pointerEvents={playerVisible ? 'auto' : 'none'}>
        <View style={miniCardVisible ? styles.miniStage : styles.stageFill}>
          {mountPlayer && item.kind === 'youtube' && item.youtubeVideoId ? (
            <YouTubePlayer
              key={item.key}
              ref={ytRef}
              youtubeVideoId={item.youtubeVideoId}
              autoplay={autoplayEnabled}
              onPlayingChange={setPlaying}
              onReady={() => {
                // Rescue hand-back: if the Watch screen's rescue
                // player left a position for this item, continue
                // from there instead of restarting (fix round 4
                // follow-up — the fresh instance otherwise begins
                // at 0 / jumps a live stream to the edge).
                const st = usePlaybackStore.getState();
                const rp = st.rescuePosition;
                if (rp && rp.key === item.key && rp.seconds > 1) {
                  ytRef.current?.seekTo(rp.seconds);
                }
                if (rp) st.setRescuePosition(null);
              }}
            />
          ) : mountPlayer && item.kind === 'hosted' && item.videoRowId ? (
            <HostedWatchPlayer
              key={item.key}
              ref={hostedRef}
              videoId={item.videoRowId}
              thumbnailUrl={item.thumbnailUrl}
              autoplay={autoplayEnabled}
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
          // The card body expands (the dock beside it carries the
          // title and the transport/close controls — nothing rides
          // on the picture any more, fix round 4 #20).
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={expandToWatch}
            accessibilityRole="button"
            accessibilityLabel="Expand player"
          />
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
    // The mini dock (fix round 4 #20): a solid strip docked above
    // the bottom nav — spacer where the player window sits, then
    // the title/channel, then real buttons beside the picture.
    miniDock: {
      position: 'absolute',
      left: 0,
      right: 0,
      height: 129,
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 8,
      gap: 10,
      backgroundColor: colors.surface,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
      shadowColor: '#000000',
      shadowOpacity: 0.18,
      shadowRadius: 8,
      shadowOffset: { width: 0, height: -2 },
      elevation: 10,
    },
    miniDockSpacer: { width: 200, height: 113 },
    miniDockText: { flex: 1, justifyContent: 'center' },
    miniDockTitle: { ...typography.cardTitle, color: colors.text },
    miniDockChannel: { ...typography.metadata, color: colors.textSecondary, marginTop: 2 },
    miniDockBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
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
