import React, {
  forwardRef,
  memo,
  useCallback,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  ActivityIndicator,
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
import { layout, spacing, useTheme, type ThemeColors } from '../../theme';

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
  onError?: (message: string) => void;
  /**
   * Show the seek timeline. Session screens hide it while a session
   * is NOW PLAYING (the group position is authoritative) and show it
   * for COMPLETED replay.
   */
  showScrubber?: boolean;
}

const RATES = [1, 1.25, 1.5, 2, 0.75];

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
      onError,
      showScrubber = true,
    },
    ref,
  ) {
    const { colors } = useTheme();
    const styles = useMemo(() => createStyles(colors), [colors]);
    const viewRef = useRef<VideoView>(null);
    const readyHandledFor = useRef<string | null>(null);
    const callbacks = useRef({ onTimeUpdate, onReady, onError });
    callbacks.current = { onTimeUpdate, onReady, onError };

    const [initialStart] = useState(() => Math.max(0, Math.floor(startSeconds)));
    const [errorMessage, setErrorMessage] = useState<string | null>(null);
    const [scrubbing, setScrubbing] = useState<number | null>(null);
    const [rateIndex, setRateIndex] = useState(0);
    const trackWidth = useRef(0);

    const player = useVideoPlayer(uri, (p) => {
      p.timeUpdateEventInterval = 1;
      p.loop = false;
    });

    const { isPlaying } = useEvent(player, 'playingChange', { isPlaying: player.playing });
    const { status } = useEvent(player, 'statusChange', { status: player.status });
    const [currentTime, setCurrentTime] = useState(0);
    const duration = player.duration > 0 ? player.duration : 0;

    useEventListener(player, 'timeUpdate', ({ currentTime: t }) => {
      setCurrentTime(t);
      callbacks.current.onTimeUpdate?.(t);
    });

    useEventListener(player, 'statusChange', ({ status: next, error }) => {
      if (next === 'readyToPlay' && readyHandledFor.current !== uri) {
        readyHandledFor.current = uri;
        if (initialStart > 0) player.currentTime = initialStart;
        if (autoplay) player.play();
        callbacks.current.onReady?.();
      }
      if (next === 'error') {
        const message = error?.message ?? 'This recording could not be played.';
        setErrorMessage(message);
        callbacks.current.onError?.(message);
      }
    });

    useImperativeHandle(ref, () => ({
      seekTo: (seconds: number) => {
        player.currentTime = Math.max(0, seconds);
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
        if (duration <= 0 || trackWidth.current <= 0) return;
        const ratio = Math.min(1, Math.max(0, x / trackWidth.current));
        const target = ratio * duration;
        setScrubbing(target);
        return target;
      },
      [duration],
    );

    const scrubResponder = useMemo(
      () =>
        PanResponder.create({
          onStartShouldSetPanResponder: () => duration > 0,
          onMoveShouldSetPanResponder: () => duration > 0,
          onPanResponderGrant: (e: GestureResponderEvent) =>
            seekFromTrackX(e.nativeEvent.locationX),
          onPanResponderMove: (e: GestureResponderEvent) =>
            seekFromTrackX(e.nativeEvent.locationX),
          onPanResponderRelease: () => {
            setScrubbing((target) => {
              if (target != null) player.currentTime = target;
              return null;
            });
          },
        }),
      [duration, player, seekFromTrackX],
    );

    const displayTime = scrubbing ?? currentTime;
    const progress = duration > 0 ? Math.min(1, displayTime / duration) : 0;
    const buffering = status === 'loading';

    if (errorMessage) {
      return (
        <View style={[styles.wrap, styles.errorWrap]}>
          <MaterialIcons name="error-outline" size={32} color="#FFFFFF" />
          <Text style={styles.errorText}>{errorMessage}</Text>
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
        {buffering ? (
          <View style={styles.buffering} pointerEvents="none">
            <ActivityIndicator color="#FFFFFF" size="large" />
          </View>
        ) : null}
        <View style={styles.controls}>
          <Pressable
            onPress={() => (isPlaying ? player.pause() : player.play())}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={isPlaying ? 'Pause' : 'Play'}
            style={styles.controlButton}
          >
            <MaterialIcons name={isPlaying ? 'pause' : 'play-arrow'} size={26} color="#FFFFFF" />
          </Pressable>
          <Text style={styles.timeText}>
            {formatClock(displayTime)} / {formatClock(duration)}
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
              const next = (rateIndex + 1) % RATES.length;
              setRateIndex(next);
              player.playbackRate = RATES[next];
            }}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Playback speed"
            style={styles.controlButton}
          >
            <Text style={styles.rateText}>{RATES[rateIndex]}×</Text>
          </Pressable>
          <Pressable
            onPress={() => player.muted = !player.muted}
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
            onPress={() => void viewRef.current?.enterFullscreen()}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Fullscreen"
            style={styles.controlButton}
          >
            <MaterialIcons name="fullscreen" size={24} color="#FFFFFF" />
          </Pressable>
        </View>
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
    },
    video: { flex: 1, backgroundColor: colors.playerBackground },
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
    rateText: { color: '#FFFFFF', fontSize: 12, fontWeight: '700' },
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
  });
