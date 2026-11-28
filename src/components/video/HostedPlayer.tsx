import React, {
  forwardRef,
  memo,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  ActivityIndicator,
  Modal,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  View,
  type GestureResponderEvent,
} from 'react-native';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useEvent, useEventListener } from 'expo';
import { useVideoPlayer, VideoView } from 'expo-video';
import { layout, radii, spacing, useTheme, type ThemeColors } from '../../theme';

export interface HostedPlayerHandle {
  /** Seek to an absolute position (seconds). */
  seekTo: (seconds: number) => void;
  play: () => void;
  pause: () => void;
  /** Set playback rate (e.g. 0.75, 1, 1.25, 1.5, 2). */
  setRate: (rate: number) => void;
}

export interface HostedPlayerProps {
  /** Signed HLS (or MP4) URL — minted short-lived by r2-playback. */
  uri: string;
  /** Resume / join position in seconds, applied once when ready. */
  startSeconds?: number;
  autoplay?: boolean;
  /** Player-reported position, ~every 1s while playing. */
  onTimeUpdate?: (seconds: number) => void;
  onReady?: () => void;
  /** The player's discovered duration (seconds), fired once per source when known. */
  onDuration?: (seconds: number) => void;
  onError?: (message: string) => void;
  /**
   * Re-mint a fresh playback URL after a playback error. Signed URLs
   * are short-lived (15 min) while a samagam runs 2+ hours — a range
   * request issued after expiry fails with 403 and surfaces as a
   * player error. When this callback is provided, the player quietly
   * swaps in a fresh URL and resumes at the same position (max 3
   * attempts) instead of dying mid-samagam; only if refresh fails or
   * is exhausted does the error state show.
   */
  onRefreshUri?: () => Promise<string | null>;
  /**
   * Show the seek timeline. During a NOW PLAYING session the timeline
   * stays visible but is capped at the live edge (see
   * liveEdgeSeconds); COMPLETED replay seeks the full duration.
   */
  showScrubber?: boolean;
  /**
   * Live-edge cap in seconds for a NOW PLAYING session: the seekable
   * range ends at the edge — the viewer can scrub BACK over the part
   * already played but never past the edge into the unplayed future
   * (real live behaviour, user order 28 Nov 2026). Null/absent means
   * the full duration is seekable (replay / plain watch).
   */
  liveEdgeSeconds?: number | null;
  /** Lock the settings sheet's Playback speed row (a live Samagam plays at 1× for everyone). */
  lockRate?: boolean;
  /** Fired when the VIEWER commits a seek (scrub release, ∓10 s buttons, double-tap, LIVE pill). */
  onUserSeek?: (seconds: number) => void;
  /** The player's own transport state, as it changes. */
  onPlayingChange?: (playing: boolean) => void;
  /**
   * Mini-player mode (Phase E): render ONLY the video surface — no
   * tap layer, no chrome, no settings sheet. The persistent host
   * shrinks this into the small floating view; its own bar carries
   * play/pause/close. Playback, URL refresh and error recovery all
   * keep working (they live in the hooks, not the chrome).
   */
  mini?: boolean;
}

const RATES = [1, 1.25, 1.5, 2, 0.75];
/** Speed choices as the settings sheet lists them (ascending, YouTube order). */
const RATE_OPTIONS = [0.75, 1, 1.25, 1.5, 2];

function formatClock(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m);
  const ss = String(sec).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/**
 * Native player for HOSTED videos (expo-video: Media3 on Android,
 * AVPlayer on iOS, HTML5/hls.js on web). This component exists ONLY
 * for recordings we host ourselves with the rights holder's
 * permission — custom controls are legitimate here because it is our
 * own player and our own hosted media. It is never used for YouTube
 * content (that stays in the official embed, untouched).
 */
export const HostedPlayer = memo(
  forwardRef<HostedPlayerHandle, HostedPlayerProps>(function HostedPlayer(
    {
      uri,
      startSeconds = 0,
      autoplay = false,
      onTimeUpdate,
      onReady,
      onDuration,
      onError,
      onRefreshUri,
      showScrubber = true,
      liveEdgeSeconds = null,
      lockRate,
      onUserSeek,
      onPlayingChange,
      mini = false,
    },
    ref,
  ) {
    const { colors } = useTheme();
    const styles = useMemo(() => createStyles(colors), [colors]);
    const viewRef = useRef<VideoView>(null);
    const readyHandledFor = useRef<string | null>(null);
    const durationReportedFor = useRef<string | null>(null);
    const callbacks = useRef({ onTimeUpdate, onReady, onDuration, onError, onRefreshUri, onPlayingChange, onUserSeek });
    callbacks.current = { onTimeUpdate, onReady, onDuration, onError, onRefreshUri, onPlayingChange, onUserSeek };
    // Signed-URL refresh bookkeeping (see onRefreshUri): last known
    // position / play state for a seamless resume, plus attempt caps.
    const positionRef = useRef(0);
    const wasPlayingRef = useRef(false);
    const refreshCountRef = useRef(0);
    const refreshingRef = useRef(false);
    const [refreshing, setRefreshing] = useState(false);

    const [initialStart] = useState(() => Math.max(0, Math.floor(startSeconds)));
    const [errorMessage, setErrorMessage] = useState<string | null>(null);
    const [scrubbing, setScrubbing] = useState<number | null>(null);
    const [rateIndex, setRateIndex] = useState(0);
    const trackWidth = useRef(0);
    // YouTube-style control chrome (Phase C parity): the controls
    // auto-hide while playing, a tap toggles them, a double-tap on
    // the left/right third seeks ∓10s, and the gear opens a settings
    // sheet (Quality / Playback speed / Captions) modelled on the
    // real YouTube sheet — only rows that are TRUE for our own
    // hosted files are shown (one original quality; no caption
    // tracks exist, so Captions honestly reads Unavailable).
    const [controlsVisible, setControlsVisible] = useState(true);
    const [sheetOpen, setSheetOpen] = useState(false);
    const [sheetView, setSheetView] = useState<'menu' | 'speed' | 'quality'>('menu');
    const [seekFlash, setSeekFlash] = useState<'back' | 'fwd' | null>(null);
    const [videoHeight, setVideoHeight] = useState<number | null>(null);
    const lastTapRef = useRef<{ at: number; side: 'back' | 'fwd' } | null>(null);
    const toggleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const seekFlashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const player = useVideoPlayer(uri, (p) => {
      p.timeUpdateEventInterval = 1;
      p.loop = false;
    });

    const { isPlaying } = useEvent(player, 'playingChange', { isPlaying: player.playing });
    const { status } = useEvent(player, 'statusChange', { status: player.status });
    const [currentTime, setCurrentTime] = useState(0);
    const duration = player.duration > 0 ? player.duration : 0;
    // Live-edge plumbing: while a session is NOW PLAYING, every seek
    // surface (scrub bar, ∓10 s, double-tap, the imperative handle)
    // clamps to seekCap instead of the full duration, and the
    // progress bar fills toward the edge — the unplayed future
    // simply does not exist on the bar, exactly like a real live
    // stream. The speed lock decouples from the scrubber here:
    // a live session HAS a scrubber now but still plays at 1×.
    const liveEdge = liveEdgeSeconds != null ? Math.max(0, liveEdgeSeconds) : null;
    const seekCap =
      liveEdge != null ? (duration > 0 ? Math.min(liveEdge, duration) : liveEdge) : duration;
    const rateLocked = lockRate ?? !showScrubber;
    const scrubTargetRef = useRef<number | null>(null);

    useEventListener(player, 'timeUpdate', ({ currentTime: t }) => {
      positionRef.current = t;
      setCurrentTime(t);
      callbacks.current.onTimeUpdate?.(t);
    });

    useEventListener(player, 'playingChange', ({ isPlaying: playing }) => {
      wasPlayingRef.current = playing;
      callbacks.current.onPlayingChange?.(playing);
    });

    useEventListener(player, 'statusChange', ({ status: next, error }) => {
      if (next === 'readyToPlay' && readyHandledFor.current !== uri) {
        readyHandledFor.current = uri;
        if (initialStart > 0) player.currentTime = initialStart;
        if (autoplay) player.play();
        callbacks.current.onReady?.();
      }
      if (next === 'readyToPlay') {
        // The REAL rendition height for the settings sheet's
        // Quality row (e.g. 1080 → "1080p") — read from the loaded
        // track, never assumed.
        const h = player.videoTrack?.size?.height;
        if (h && h > 0) setVideoHeight(Math.round(h));
      }
      if (
        next === 'readyToPlay' &&
        durationReportedFor.current !== uri &&
        player.duration > 0
      ) {
        durationReportedFor.current = uri;
        callbacks.current.onDuration?.(player.duration);
      }
      if (next === 'error') {
        // First try a silent signed-URL refresh + resume (the usual
        // cause mid-samagam is the 15-minute signature expiring, not
        // a broken file). Only a failed/exhausted refresh surfaces
        // the error state.
        const refresh = callbacks.current.onRefreshUri;
        if (refresh && refreshCountRef.current < 3 && !refreshingRef.current) {
          refreshingRef.current = true;
          refreshCountRef.current += 1;
          setRefreshing(true);
          const resumeAt = positionRef.current;
          const resumePlaying = wasPlayingRef.current || autoplay;
          refresh()
            .then(async (newUri) => {
              if (!newUri) throw new Error('refresh returned no URL');
              await player.replaceAsync(newUri);
              if (resumeAt > 0) player.currentTime = resumeAt;
              if (resumePlaying) player.play();
            })
            .catch(() => {
              const message = error?.message ?? 'This recording could not be played.';
              setErrorMessage(message);
              callbacks.current.onError?.(message);
            })
            .finally(() => {
              refreshingRef.current = false;
              setRefreshing(false);
            });
          return;
        }
        const message = error?.message ?? 'This recording could not be played.';
        setErrorMessage(message);
        callbacks.current.onError?.(message);
      }
    });

    useImperativeHandle(ref, () => ({
      seekTo: (seconds: number) => {
        const upper = liveEdge != null && seekCap > 0 ? seekCap : Number.MAX_SAFE_INTEGER;
        player.currentTime = Math.min(Math.max(0, seconds), upper);
      },
      play: () => player.play(),
      pause: () => player.pause(),
      setRate: (rate: number) => {
        player.playbackRate = rate;
        const idx = RATES.indexOf(rate);
        if (idx >= 0) setRateIndex(idx);
      },
    }));

    const seekFromTrackX = useCallback(
      (x: number) => {
        if (seekCap <= 0 || trackWidth.current <= 0) return;
        const ratio = Math.min(1, Math.max(0, x / trackWidth.current));
        const target = ratio * seekCap;
        scrubTargetRef.current = target;
        setScrubbing(target);
        return target;
      },
      [seekCap],
    );

    const scrubResponder = useMemo(
      () =>
        PanResponder.create({
          onStartShouldSetPanResponder: () => seekCap > 0,
          onMoveShouldSetPanResponder: () => seekCap > 0,
          onPanResponderGrant: (e: GestureResponderEvent) =>
            seekFromTrackX(e.nativeEvent.locationX),
          onPanResponderMove: (e: GestureResponderEvent) =>
            seekFromTrackX(e.nativeEvent.locationX),
          onPanResponderRelease: () => {
            const target = scrubTargetRef.current;
            scrubTargetRef.current = null;
            setScrubbing(null);
            if (target != null) {
              player.currentTime = target;
              positionRef.current = target;
              setCurrentTime(target);
              callbacks.current.onUserSeek?.(target);
            }
          },
        }),
      [seekCap, player, seekFromTrackX],
    );

    const displayTime = scrubbing ?? currentTime;
    const progress = seekCap > 0 ? Math.min(1, displayTime / seekCap) : 0;
    const behindLive = liveEdge != null && seekCap - displayTime > 2;
    const buffering = status === 'loading' || refreshing;

    // ── YouTube-style chrome behaviour ─────────────────────────────
    const [controlsEpoch, setControlsEpoch] = useState(0);
    const pokeControls = useCallback(() => {
      setControlsVisible(true);
      setControlsEpoch((n) => n + 1);
    }, []);

    // Auto-hide while playing (paused, sheet-open or mid-scrub
    // keeps the chrome up). The epoch restarts the countdown on
    // every poke.
    useEffect(() => {
      if (!controlsVisible || !isPlaying || sheetOpen || scrubbing != null) return;
      const t = setTimeout(() => setControlsVisible(false), 3200);
      return () => clearTimeout(t);
    }, [controlsVisible, controlsEpoch, isPlaying, sheetOpen, scrubbing]);

    useEffect(
      () => () => {
        if (toggleTimerRef.current) clearTimeout(toggleTimerRef.current);
        if (seekFlashTimerRef.current) clearTimeout(seekFlashTimerRef.current);
      },
      [],
    );

    const seekBy = useCallback(
      (delta: number) => {
        const upper = seekCap > 0 ? seekCap : Number.MAX_SAFE_INTEGER;
        const target = Math.min(Math.max(0, positionRef.current + delta), upper);
        player.currentTime = target;
        positionRef.current = target;
        setCurrentTime(target);
        callbacks.current.onUserSeek?.(target);
      },
      [player, seekCap],
    );

    const goToLiveEdge = useCallback(() => {
      if (seekCap <= 0) return;
      player.currentTime = seekCap;
      positionRef.current = seekCap;
      setCurrentTime(seekCap);
      callbacks.current.onUserSeek?.(seekCap);
      pokeControls();
    }, [player, seekCap, pokeControls]);

    const tapWidthRef = useRef(0);
    const handleVideoTap = useCallback(
      (e: GestureResponderEvent) => {
        const now = Date.now();
        const w = tapWidthRef.current;
        const x = e.nativeEvent.locationX;
        const side: 'back' | 'fwd' | 'mid' =
          w > 0 && x < w / 3 ? 'back' : w > 0 && x > (2 * w) / 3 ? 'fwd' : 'mid';
        const last = lastTapRef.current;
        if (showScrubber && side !== 'mid' && last && last.side === side && now - last.at < 300) {
          // Double-tap seek ∓10 s (the YouTube gesture). Only where
          // seeking is allowed at all (showScrubber); during a live
          // Samagam seekBy clamps the target at the live edge.
          lastTapRef.current = null;
          if (toggleTimerRef.current) {
            clearTimeout(toggleTimerRef.current);
            toggleTimerRef.current = null;
          }
          seekBy(side === 'fwd' ? 10 : -10);
          setSeekFlash(side);
          if (seekFlashTimerRef.current) clearTimeout(seekFlashTimerRef.current);
          seekFlashTimerRef.current = setTimeout(() => setSeekFlash(null), 550);
          return;
        }
        lastTapRef.current = side === 'mid' ? null : { at: now, side };
        // Delay the toggle a beat so a double-tap doesn't flicker
        // the chrome before the seek lands.
        if (toggleTimerRef.current) clearTimeout(toggleTimerRef.current);
        toggleTimerRef.current = setTimeout(() => {
          setControlsVisible((v) => !v);
          setControlsEpoch((n) => n + 1);
        }, 290);
      },
      [seekBy, showScrubber],
    );

    const openSettings = useCallback(() => {
      setSheetView('menu');
      setSheetOpen(true);
      pokeControls();
    }, [pokeControls]);

    const chooseRate = useCallback(
      (rate: number) => {
        player.playbackRate = rate;
        const idx = RATES.indexOf(rate);
        if (idx >= 0) setRateIndex(idx);
        setSheetOpen(false);
      },
      [player],
    );

    // Manual retry from the error state (audit B1): re-mint the
    // signed URL through the same path the silent refresh uses and
    // resume at the last known position — the error view must never
    // be a dead end mid-samagam.
    const retryFromError = () => {
      const resumeAt = positionRef.current;
      const resumePlaying = wasPlayingRef.current || autoplay;
      setErrorMessage(null);
      refreshCountRef.current = 0;
      const applyUri = async (newUri: string) => {
        await player.replaceAsync(newUri);
        if (resumeAt > 0) player.currentTime = resumeAt;
        if (resumePlaying) player.play();
      };
      const refresh = callbacks.current.onRefreshUri;
      if (refresh) {
        refreshingRef.current = true;
        setRefreshing(true);
        refresh()
          .then(async (newUri) => {
            if (!newUri) throw new Error('refresh returned no URL');
            await applyUri(newUri);
          })
          .catch(() => setErrorMessage('This recording could not be played.'))
          .finally(() => {
            refreshingRef.current = false;
            setRefreshing(false);
          });
      } else {
        void applyUri(uri).catch(() =>
          setErrorMessage('This recording could not be played.'),
        );
      }
    };

    if (errorMessage) {
      return (
        <View style={[styles.wrap, styles.errorWrap]}>
          <MaterialIcons name="error-outline" size={32} color="#FFFFFF" />
          <Text style={styles.errorText}>{errorMessage}</Text>
          <Pressable
            onPress={retryFromError}
            style={({ pressed }) => [styles.retryButton, pressed && styles.pressedDim]}
            accessibilityRole="button"
            accessibilityLabel="Retry playback"
          >
            <Text style={styles.retryText}>Retry</Text>
          </Pressable>
        </View>
      );
    }

    if (mini) {
      // Phase E floating mini: the bare video surface only. The
      // host's frame around it carries expand/close; transport is
      // driven through the imperative handle by the host's bar.
      return (
        <View style={styles.wrap}>
          <VideoView
            ref={viewRef}
            player={player}
            style={styles.video}
            contentFit="contain"
            nativeControls={false}
            allowsPictureInPicture
          />
        </View>
      );
    }

    return (
      <View style={styles.wrap}>
        <VideoView
          ref={viewRef}
          player={player}
          style={styles.video}
          contentFit="contain"
          nativeControls={false}
          allowsPictureInPicture
        />
        {/* Tap layer: single tap toggles the chrome, double-tap on
            the outer thirds seeks ∓10 s (YouTube gestures). Sits
            above the video, below every control. */}
        <Pressable
          style={styles.tapLayer}
          onLayout={(e) => {
            tapWidthRef.current = e.nativeEvent.layout.width;
          }}
          onPress={handleVideoTap}
          accessibilityRole="button"
          accessibilityLabel="Toggle player controls"
        />
        {seekFlash ? (
          <View
            style={[styles.seekFlash, seekFlash === 'back' ? styles.seekFlashLeft : styles.seekFlashRight]}
            pointerEvents="none"
          >
            <MaterialIcons name={seekFlash === 'back' ? 'replay-10' : 'forward-10'} size={30} color="#FFFFFF" />
            <Text style={styles.seekFlashText}>
              {seekFlash === 'back' ? '10 seconds back' : '10 seconds forward'}
            </Text>
          </View>
        ) : null}
        {buffering ? (
          <View style={styles.buffering} pointerEvents="none">
            <ActivityIndicator color="#FFFFFF" size="large" />
          </View>
        ) : null}
        {controlsVisible ? (
          <>
            {/* Top bar: mute + the settings gear (YouTube places its
                player actions top-right). */}
            <View style={styles.topBar} pointerEvents="box-none">
              <Pressable
                onPress={() => {
                  player.muted = !player.muted;
                  pokeControls();
                }}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel={player.muted ? 'Unmute' : 'Mute'}
                style={styles.controlButton}
              >
                <MaterialIcons
                  name={player.muted ? 'volume-off' : 'volume-up'}
                  size={22}
                  color="#FFFFFF"
                />
              </Pressable>
              <Pressable
                onPress={openSettings}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="Player settings"
                style={styles.controlButton}
              >
                <MaterialIcons name="settings" size={22} color="#FFFFFF" />
              </Pressable>
            </View>
            {/* Centre transport: ∓10 s around a large play/pause
                (YouTube's centre cluster). Seek buttons exist only
                where seeking is allowed (not during a live Samagam). */}
            <View style={styles.centerRow} pointerEvents="box-none">
              {showScrubber ? (
                <Pressable
                  onPress={() => {
                    seekBy(-10);
                    pokeControls();
                  }}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel="Back 10 seconds"
                  style={styles.centerSideButton}
                >
                  <MaterialIcons name="replay-10" size={26} color="#FFFFFF" />
                </Pressable>
              ) : (
                <View style={styles.centerSideSpacer} />
              )}
              <Pressable
                onPress={() => {
                  if (isPlaying) player.pause();
                  else player.play();
                  pokeControls();
                }}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel={isPlaying ? 'Pause' : 'Play'}
                style={styles.centerPlayButton}
              >
                <MaterialIcons name={isPlaying ? 'pause' : 'play-arrow'} size={40} color="#FFFFFF" />
              </Pressable>
              {showScrubber ? (
                <Pressable
                  onPress={() => {
                    seekBy(10);
                    pokeControls();
                  }}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel="Forward 10 seconds"
                  style={styles.centerSideButton}
                >
                  <MaterialIcons name="forward-10" size={26} color="#FFFFFF" />
                </Pressable>
              ) : (
                <View style={styles.centerSideSpacer} />
              )}
            </View>
          </>
        ) : null}
        {controlsVisible ? (
          <View style={styles.controls}>
            {/* The LIVE pill leads the bottom bar during a live
                session, where YouTube puts it: bright red and
                tappable while the viewer is behind the edge (it
                jumps back to the edge); calm dark once at the edge. */}
            {liveEdge != null ? (
              <Pressable
                onPress={goToLiveEdge}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel={behindLive ? 'Go to live' : 'Live'}
                style={[styles.livePill, behindLive ? styles.livePillBehind : styles.livePillAtEdge]}
              >
                <View style={styles.liveDot} />
                <Text style={styles.livePillText}>LIVE</Text>
              </Pressable>
            ) : null}
            <Text style={styles.timeText}>
              {liveEdge != null
                ? formatClock(displayTime)
                : `${formatClock(displayTime)} / ${formatClock(duration)}`}
            </Text>
            {showScrubber ? (
              <View
                style={styles.track}
                onLayout={(e) => {
                  trackWidth.current = e.nativeEvent.layout.width;
                }}
                {...scrubResponder.panHandlers}
              >
                <View style={styles.trackBackground} />
                <View style={[styles.trackFill, { width: `${progress * 100}%` }]} />
                <View style={[styles.trackThumb, { left: `${progress * 100}%` }]} />
              </View>
            ) : (
              <View style={styles.trackSpacer} />
            )}
            <Pressable
              onPress={() => {
                pokeControls();
                void viewRef.current?.enterFullscreen();
              }}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Fullscreen"
              style={styles.controlButton}
            >
              <MaterialIcons name="fullscreen" size={24} color="#FFFFFF" />
            </Pressable>
          </View>
        ) : showScrubber ? (
          // Chrome hidden: YouTube still shows the thin red
          // progress line at the very bottom.
          <View style={styles.miniProgress} pointerEvents="none">
            <View style={[styles.miniProgressFill, { width: `${progress * 100}%` }]} />
          </View>
        ) : null}
        {/* Settings sheet (YouTube gear menu): Quality / Playback
            speed / Captions — only what is true for our own hosted
            files. One original quality (the real track height when
            the player reports it); captions honestly Unavailable. */}
        <Modal
          visible={sheetOpen}
          transparent
          animationType="slide"
          onRequestClose={() => setSheetOpen(false)}
        >
          <View style={styles.sheetBackdrop}>
            <Pressable
              style={styles.sheetBackdropTap}
              onPress={() => setSheetOpen(false)}
              accessibilityLabel="Close settings"
            />
            <View style={styles.sheet}>
              <View style={styles.sheetHandle} />
              {sheetView === 'menu' ? (
                <>
                  <Pressable
                    style={styles.sheetRow}
                    onPress={() => setSheetView('quality')}
                    accessibilityRole="button"
                  >
                    <MaterialIcons name="tune" size={22} color={colors.text} />
                    <Text style={styles.sheetRowLabel}>Quality</Text>
                    <Text style={styles.sheetRowValue}>
                      {videoHeight ? `${videoHeight}p` : 'Original'}
                    </Text>
                    <MaterialIcons name="chevron-right" size={20} color={colors.textSecondary} />
                  </Pressable>
                  <Pressable
                    style={[styles.sheetRow, rateLocked && styles.sheetRowDim]}
                    onPress={() => {
                      if (!rateLocked) setSheetView('speed');
                    }}
                    accessibilityRole="button"
                    accessibilityLabel="Playback speed"
                  >
                    <MaterialIcons name="slow-motion-video" size={22} color={colors.text} />
                    <Text style={styles.sheetRowLabel}>Playback speed</Text>
                    <Text style={styles.sheetRowValue}>
                      {rateLocked ? 'Locked' : `${RATES[rateIndex]}×`}
                    </Text>
                    <MaterialIcons name="chevron-right" size={20} color={colors.textSecondary} />
                  </Pressable>
                  <View style={styles.sheetRow}>
                    <MaterialIcons name="closed-caption" size={22} color={colors.textSecondary} />
                    <Text style={[styles.sheetRowLabel, styles.sheetRowDimText]}>Captions</Text>
                    <Text style={styles.sheetRowDimText}>Unavailable</Text>
                    <MaterialIcons name="chevron-right" size={20} color="#555555" />
                  </View>
                </>
              ) : sheetView === 'speed' ? (
                <>
                  <Pressable
                    style={styles.sheetBackRow}
                    onPress={() => setSheetView('menu')}
                    accessibilityRole="button"
                    accessibilityLabel="Back to settings"
                  >
                    <MaterialIcons name="arrow-back" size={20} color={colors.text} />
                    <Text style={styles.sheetBackLabel}>Playback speed</Text>
                  </Pressable>
                  {RATE_OPTIONS.map((rate) => (
                    <Pressable
                      key={rate}
                      style={styles.sheetRow}
                      onPress={() => chooseRate(rate)}
                      accessibilityRole="button"
                    >
                      <View style={styles.sheetCheck}>
                        {RATES[rateIndex] === rate ? (
                          <MaterialIcons name="check" size={18} color={colors.text} />
                        ) : null}
                      </View>
                      <Text style={styles.sheetRowLabel}>{rate === 1 ? 'Normal' : `${rate}×`}</Text>
                    </Pressable>
                  ))}
                </>
              ) : (
                <>
                  <Pressable
                    style={styles.sheetBackRow}
                    onPress={() => setSheetView('menu')}
                    accessibilityRole="button"
                    accessibilityLabel="Back to settings"
                  >
                    <MaterialIcons name="arrow-back" size={20} color={colors.text} />
                    <Text style={styles.sheetBackLabel}>Quality</Text>
                  </Pressable>
                  <View style={styles.sheetRow}>
                    <View style={styles.sheetCheck}>
                      <MaterialIcons name="check" size={18} color={colors.text} />
                    </View>
                    <Text style={styles.sheetRowLabel}>
                      {videoHeight ? `${videoHeight}p` : 'Original'}
                    </Text>
                  </View>
                  <Text style={styles.sheetNote}>
                    This recording is hosted as one original file, so there is a single
                    quality — the original, exactly as it was given to us.
                  </Text>
                </>
              )}
            </View>
          </View>
        </Modal>
      </View>
    );
  }),
);

const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    wrap: {
      width: '100%',
      aspectRatio: layout.thumbnailAspectRatio,
      backgroundColor: colors.playerBackground,
      // Clip the video surface to the 16:9 box, always: on web a
      // portrait source's <video> element otherwise renders at its
      // intrinsic aspect and spills far below the player over the
      // sheet (user's phone screenshot, 27 Nov 2026 — the frame ran
      // to ~63% of the screen while the chrome ended at ~34%).
      overflow: 'hidden',
    },
    // Pin the surface to the wrap's exact box instead of flex
    // sizing: a flex-sized replaced element can still grow to its
    // intrinsic height on web; an absolutely-pinned one cannot,
    // and contentFit="contain" then letterboxes the frame inside
    // the box exactly like YouTube.
    video: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: colors.playerBackground,
    },
    buffering: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      alignItems: 'center',
      justifyContent: 'center',
    },
    controls: {
      position: 'absolute',
      left: 0,
      right: 0,
      bottom: 0,
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      paddingHorizontal: spacing.sm,
      paddingVertical: spacing.xs,
      backgroundColor: 'rgba(0,0,0,0.55)',
    },
    controlButton: {
      minWidth: 36,
      minHeight: 36,
      alignItems: 'center',
      justifyContent: 'center',
    },
    timeText: { color: '#FFFFFF', fontSize: 12, fontVariant: ['tabular-nums'] },
    tapLayer: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
    seekFlash: {
      position: 'absolute',
      top: 0,
      bottom: 0,
      width: '40%',
      alignItems: 'center',
      justifyContent: 'center',
      gap: spacing.xs,
    },
    seekFlashLeft: { left: 0 },
    seekFlashRight: { right: 0 },
    seekFlashText: { color: '#FFFFFF', fontSize: 12, fontWeight: '600' },
    topBar: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'flex-end',
      gap: spacing.xs,
      paddingHorizontal: spacing.sm,
      paddingVertical: spacing.xs,
    },
    livePill: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
      borderRadius: 4,
      paddingHorizontal: 8,
      paddingVertical: 4,
    },
    livePillBehind: { backgroundColor: '#FF0000' },
    livePillAtEdge: { backgroundColor: 'rgba(0,0,0,0.55)' },
    liveDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#FFFFFF' },
    livePillText: { color: '#FFFFFF', fontSize: 12, fontWeight: '700', letterSpacing: 0.5 },
    centerRow: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: spacing.xl,
    },
    centerPlayButton: {
      width: 68,
      height: 68,
      borderRadius: 34,
      backgroundColor: 'rgba(0,0,0,0.55)',
      alignItems: 'center',
      justifyContent: 'center',
    },
    centerSideButton: {
      width: 48,
      height: 48,
      borderRadius: 24,
      backgroundColor: 'rgba(0,0,0,0.45)',
      alignItems: 'center',
      justifyContent: 'center',
    },
    centerSideSpacer: { width: 48, height: 48 },
    miniProgress: {
      position: 'absolute',
      left: 0,
      right: 0,
      bottom: 0,
      height: 3,
      backgroundColor: 'rgba(255,255,255,0.25)',
    },
    miniProgressFill: { height: 3, backgroundColor: '#FF0000' },
    sheetBackdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.5)' },
    sheetBackdropTap: { flex: 1 },
    sheet: {
      backgroundColor: colors.surface,
      borderTopLeftRadius: 16,
      borderTopRightRadius: 16,
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.sm,
      paddingBottom: spacing.xxl,
    },
    sheetHandle: {
      width: 36,
      height: 4,
      borderRadius: 2,
      backgroundColor: colors.border,
      alignSelf: 'center',
      marginBottom: spacing.md,
    },
    sheetRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      minHeight: 52,
      paddingVertical: spacing.sm,
    },
    sheetRowDim: { opacity: 0.55 },
    sheetRowLabel: { flex: 1, color: colors.text, fontSize: 15 },
    sheetRowValue: { color: colors.textSecondary, fontSize: 13 },
    sheetRowDimText: { color: colors.textSecondary, fontSize: 15 },
    sheetBackRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      minHeight: 48,
      paddingVertical: spacing.sm,
    },
    sheetBackLabel: { color: colors.text, fontSize: 15, fontWeight: '600' },
    sheetCheck: { width: 24, alignItems: 'center' },
    sheetNote: { color: colors.textSecondary, fontSize: 13, lineHeight: 19, paddingVertical: spacing.sm },
    track: { flex: 1, height: 28, justifyContent: 'center' },
    trackSpacer: { flex: 1 },
    trackBackground: {
      position: 'absolute',
      left: 0,
      right: 0,
      height: 3,
      borderRadius: 2,
      backgroundColor: 'rgba(255,255,255,0.35)',
    },
    trackFill: {
      position: 'absolute',
      left: 0,
      height: 3,
      borderRadius: 2,
      // YouTube's signature red progress line — the hosted session
      // player mirrors the live-watch look (user request, 27 Nov).
      backgroundColor: '#FF0000',
    },
    trackThumb: {
      position: 'absolute',
      width: 12,
      height: 12,
      borderRadius: 6,
      marginLeft: -6,
      backgroundColor: '#FF0000',
    },
    errorWrap: {
      alignItems: 'center',
      justifyContent: 'center',
      gap: spacing.sm,
      padding: spacing.lg,
    },
    errorText: { color: '#FFFFFF', fontSize: 14, textAlign: 'center' },
    retryButton: {
      marginTop: spacing.md,
      borderWidth: 1,
      borderColor: '#FFFFFF',
      borderRadius: radii.pill,
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.sm,
      minHeight: 44,
      justifyContent: 'center',
    },
    retryText: { color: '#FFFFFF', fontSize: 14, fontWeight: '600' },
    pressedDim: { opacity: 0.7 },
  });
