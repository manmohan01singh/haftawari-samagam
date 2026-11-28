import React, {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import { layout, useTheme, type ThemeColors } from '../../theme';

export interface YouTubePlayerHandle {
  play: () => void;
  pause: () => void;
  seekTo: (seconds: number) => void;
}

interface YouTubePlayerProps {
  youtubeVideoId: string;
  /** Fill the parent completely instead of holding a 16:9 box
   *  (Shorts: the player IS the full screen). */
  fill?: boolean;
  /** Loop the video when it ends (Shorts behaviour). */
  loop?: boolean;
  /** Start playback as soon as the embed loads (Watch page). The
   * browser may still block sound-on autoplay; then the embed's own
   * play button shows, exactly as before — never worse. */
  autoplay?: boolean;
  /** The embed's own API reported 'ready'. */
  onReady?: () => void;
  /**
   * The embed's own reported transport state (IFrame API
   * playerState: 1 playing, 2 paused, 0 ended, 3 buffering). The
   * mini player's bar icon reads this — it is YouTube's truth,
   * never a guess.
   */
  onPlayingChange?: (playing: boolean) => void;
}

const Iframe = 'iframe' as unknown as React.ElementType;

/**
 * Official YouTube embedded player (web / PWA): an iframe embed.
 * Same rule as native — YouTube's own player, branding, ads and
 * controls, untouched. (Metro resolves this .web variant on web.)
 *
 * Phase E: the embed runs with the IFrame API enabled so the
 * persistent mini player's bar can drive it (play/pause/seek via
 * postMessage — the documented API, the same bridge the session
 * player uses). Nothing about the visible player changes: same
 * embed, same controls, same ads.
 *
 * Loading facade (QA issues 5/6): until the iframe reports its first
 * load, the black player area shows the video's REAL YouTube
 * thumbnail (hqdefault, derived from the id — the same URL the cards
 * use) with a spinner, instead of a bare black rectangle for several
 * seconds. The facade is pointer-events-none and is removed the
 * moment the embed loads; it never covers the player, its controls
 * or its ads once playback is possible.
 */
export const YouTubePlayer = forwardRef<YouTubePlayerHandle, YouTubePlayerProps>(
  function YouTubePlayer({ youtubeVideoId, onReady, onPlayingChange, fill, loop, autoplay }, ref) {
    const { colors } = useTheme();
    const styles = useMemo(() => createStyles(colors), [colors]);
    const [loaded, setLoaded] = useState(false);
    const frameRef = useRef<{ contentWindow: Window | null } | null>(null);
    const callbacks = useRef({ onReady, onPlayingChange });
    callbacks.current = { onReady, onPlayingChange };
    const videoIdRef = useRef(youtubeVideoId);
    videoIdRef.current = youtubeVideoId;

    const command = (func: string, args: unknown[] = []) => {
      frameRef.current?.contentWindow?.postMessage(
        JSON.stringify({ event: 'command', func, args }),
        '*',
      );
    };

    useImperativeHandle(ref, () => ({
      play: () => command('playVideo'),
      pause: () => command('pauseVideo'),
      seekTo: (seconds: number) => command('seekTo', [Math.max(0, Math.floor(seconds)), true]),
    }));

    useEffect(() => {
      const onMessage = (event: MessageEvent) => {
        // Only OUR iframe may drive this player (audit P1, 28 Nov
        // 2026): every embed on the page hears every other embed's
        // messages otherwise — the parked mini-player's clock was
        // feeding the session drift checker, and any embed's
        // onReady lifted every player's facade.
        if (!frameRef.current?.contentWindow || event.source !== frameRef.current.contentWindow) return;
        if (typeof event.data !== 'string') return;
        let parsed: { event?: string; info?: { playerState?: number } };
        try {
          parsed = JSON.parse(event.data) as typeof parsed;
        } catch {
          return;
        }
        if (parsed.event === 'onReady') {
          callbacks.current.onReady?.();
        }
        if (parsed.event === 'infoDelivery' && parsed.info && typeof parsed.info.playerState === 'number') {
          callbacks.current.onPlayingChange?.(parsed.info.playerState === 1);
        }
      };
      window.addEventListener('message', onMessage);
      return () => window.removeEventListener('message', onMessage);
    }, []);

    const embedUrl =
      `https://www.youtube.com/embed/${encodeURIComponent(youtubeVideoId)}` +
      `?rel=0&playsinline=1&enablejsapi=1` +
      (loop ? `&loop=1&playlist=${encodeURIComponent(youtubeVideoId)}` : '') +
      (autoplay ? '&autoplay=1' : '');

    return (
      <View style={fill ? styles.wrapFill : styles.wrap}>
        <Iframe
          ref={frameRef}
          src={embedUrl}
          style={{ width: '100%', height: '100%', border: 0 }}
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
          allowFullScreen
          title="YouTube video player"
          onLoad={() => {
            setLoaded(true);
            frameRef.current?.contentWindow?.postMessage(
              JSON.stringify({ event: 'listening', id: 'watch-player' }),
              '*',
            );
          }}
        />
        {!loaded ? (
          <View style={styles.facade} pointerEvents="none">
            <Image
              source={{ uri: `https://i.ytimg.com/vi/${encodeURIComponent(youtubeVideoId)}/hqdefault.jpg` }}
              style={styles.poster}
              contentFit="cover"
              cachePolicy="memory-disk"
            />
            <View style={styles.spinnerWrap}>
              <ActivityIndicator color="#FFFFFF" />
            </View>
          </View>
        ) : null}
      </View>
    );
  },
);

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  wrap: {
    width: '100%',
    aspectRatio: layout.thumbnailAspectRatio,
    backgroundColor: colors.playerBackground,
  },
  wrapFill: { flex: 1, width: '100%', height: '100%', backgroundColor: colors.playerBackground },
  facade: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  poster: { width: '100%', height: '100%' },
  spinnerWrap: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
