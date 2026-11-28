import React, {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { layout, useTheme, type ThemeColors } from '../../theme';

export interface YouTubePlayerHandle {
  play: () => void;
  pause: () => void;
  seekTo: (seconds: number) => void;
  /** Mute/unmute the embed (Shorts' muted-autoplay pattern). */
  setMuted: (muted: boolean) => void;
  /** The last playback position the embed itself reported (via
   *  infoDelivery), or null when it has reported none yet. Used
   *  for the rescue-player hand-back: when the in-screen rescue
   *  player unmounts, the persistent host seeks its fresh player
   *  to this position instead of restarting the recording. */
  getCurrentTime: () => number | null;
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
  /** Start muted (the only autoplay browsers allow without a user
   *  gesture — Shorts' first-play pattern). */
  muted?: boolean;
  /** How long the loading facade waits for the embed's first
   *  ready/playing signal before offering the recovery Play
   *  button. Shorts pass a longer deadline: their off-screen
   *  players mount early and a throttled background iframe must
   *  not be declared "stuck" before it was ever visible (fault
   *  53's big red Play over a healthy paused Short). */
  facadeDeadlineMs?: number;
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
  function YouTubePlayer({ youtubeVideoId, onReady, onPlayingChange, fill, loop, autoplay, muted, facadeDeadlineMs }, ref) {
    const { colors } = useTheme();
    const styles = useMemo(() => createStyles(colors), [colors]);
    // Load signals are tagged with the load key (video + mount
    // nonce): a new video or a recovery remount changes the key and
    // every signal resets by construction — no reset effect needed.
    const [mountNonce, setMountNonce] = useState(0);
    const loadKey = `${youtubeVideoId}:${mountNonce}`;
    const [loadedKey, setLoadedKey] = useState<string | null>(null);
    const loaded = loadedKey === loadKey;
    // Facade deadline (blueprint round 2, A4): if the embed has not
    // reported ready/playing within a few seconds, the facade stops
    // being an infinite spinner and becomes a real Play button; one
    // tap remounts the iframe inside the user's own gesture, which
    // is the most reliable recovery there is. A user is never more
    // than one tap from a working player.
    const [stuckKey, setStuckKey] = useState<string | null>(null);
    const stuck = stuckKey === loadKey;
    const frameRef = useRef<{ contentWindow: Window | null } | null>(null);
    const callbacks = useRef({ onReady, onPlayingChange });
    callbacks.current = { onReady, onPlayingChange };
    const videoIdRef = useRef(youtubeVideoId);
    videoIdRef.current = youtubeVideoId;
    // Command queue + ready gate (blueprint round 2, A3):
    // postMessage commands sent before the player registers its
    // listener / reports onReady are dropped by YouTube. Commands
    // now queue until onReady, then flush in order.
    const readyRef = useRef(false);
    const playingRef = useRef(false);
    const currentTimeRef = useRef<number | null>(null);
    const queueRef = useRef<string[]>([]);

    const post = (payload: string) => {
      frameRef.current?.contentWindow?.postMessage(payload, '*');
    };

    const command = (func: string, args: unknown[] = []) => {
      const payload = JSON.stringify({ event: 'command', func, args });
      if (!readyRef.current) {
        queueRef.current.push(payload);
        return;
      }
      post(payload);
    };

    useImperativeHandle(ref, () => ({
      play: () => command('playVideo'),
      pause: () => command('pauseVideo'),
      seekTo: (seconds: number) => command('seekTo', [Math.max(0, Math.floor(seconds)), true]),
      setMuted: (m: boolean) => {
        if (m) command('mute');
        else {
          command('unMute');
          command('setVolume', [100]);
        }
      },
      getCurrentTime: () => currentTimeRef.current,
    }));

    // A new video (or a recovery remount) resets the command queue
    // and the ready/playing refs (state signals reset via loadKey).
    useEffect(() => {
      readyRef.current = false;
      playingRef.current = false;
      currentTimeRef.current = null;
      queueRef.current = [];
    }, [loadKey]);

    // The deadline: after (re)mount, if the embed has neither
    // reported ready nor started playing, surface the Play button.
    useEffect(() => {
      const t = setTimeout(() => {
        if (!readyRef.current && !playingRef.current) setStuckKey(loadKey);
      }, facadeDeadlineMs ?? 4000);
      return () => clearTimeout(t);
    }, [loadKey, facadeDeadlineMs]);

    useEffect(() => {
      const onMessage = (event: MessageEvent) => {
        // Only OUR iframe may drive this player (audit P1, 28 Nov
        // 2026): every embed on the page hears every other embed's
        // messages otherwise — the parked mini-player's clock was
        // feeding the session drift checker, and any embed's
        // onReady lifted every player's facade.
        if (!frameRef.current?.contentWindow || event.source !== frameRef.current.contentWindow) return;
        if (typeof event.data !== 'string') return;
        let parsed: { event?: string; info?: { playerState?: number; currentTime?: number } };
        try {
          parsed = JSON.parse(event.data) as typeof parsed;
        } catch {
          return;
        }
        if (parsed.event === 'onReady') {
          readyRef.current = true;
          setStuckKey(null);
          const queued = queueRef.current;
          queueRef.current = [];
          for (const payload of queued) post(payload);
          callbacks.current.onReady?.();
        }
        if (parsed.event === 'infoDelivery' && parsed.info) {
          if (typeof parsed.info.currentTime === 'number') {
            currentTimeRef.current = parsed.info.currentTime;
          }
          if (typeof parsed.info.playerState === 'number') {
            if (parsed.info.playerState === 1) {
              playingRef.current = true;
              setStuckKey(null);
            }
            callbacks.current.onPlayingChange?.(parsed.info.playerState === 1);
          }
        }
      };
      window.addEventListener('message', onMessage);
      return () => window.removeEventListener('message', onMessage);
    }, []);

    const recover = () => {
      // Remount the iframe fresh under this tap: the new embed
      // loads with autoplay=1 inside a real user-gesture chain,
      // which is what the blocked first attempt never had.
      // key change resets the stuck signal by construction
      setMountNonce((n) => n + 1);
    };

    // The mute flag is part of the embed URL, so it is captured
    // ONCE at mount: if it changed with the prop, the iframe src
    // would change and the video would restart. Later mute changes
    // travel through the setMuted command instead. (Callers key
    // the player per video, so each video gets its own mount.)
    const [initialMuted] = useState(() => muted);
    // The autoplay flag is captured ONCE at mount for the same
    // reason (fix round 5, N-7): when the Settings Autoplay switch
    // flipped, the live prop changed the embed URL of the DOCKED
    // player, the iframe reloaded — and a paused video restarted
    // BY ITSELF, sound and all, with no tap. A preference change
    // must never reload a live player; it applies to the NEXT
    // player that mounts.
    const [initialAutoplay] = useState(() => autoplay);
    const embedUrl =
      `https://www.youtube.com/embed/${encodeURIComponent(youtubeVideoId)}` +
      `?rel=0&playsinline=1&enablejsapi=1` +
      (loop ? `&loop=1&playlist=${encodeURIComponent(youtubeVideoId)}` : '') +
      (initialAutoplay ? '&autoplay=1' : '') +
      (initialMuted ? '&mute=1' : '');

    const showFacade = !loaded || stuck;
    return (
      <View style={fill ? styles.wrapFill : styles.wrap}>
        <Iframe
          key={mountNonce}
          ref={frameRef}
          src={embedUrl}
          style={{ width: '100%', height: '100%', border: 0 }}
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
          allowFullScreen
          title="YouTube video player"
          onLoad={() => {
            setLoadedKey(loadKey);
            frameRef.current?.contentWindow?.postMessage(
              JSON.stringify({ event: 'listening', id: 'watch-player' }),
              '*',
            );
          }}
        />
        {showFacade ? (
          <View style={styles.facade} pointerEvents="none">
            <Image
              source={{ uri: `https://i.ytimg.com/vi/${encodeURIComponent(youtubeVideoId)}/hqdefault.jpg` }}
              style={styles.poster}
              contentFit="cover"
              cachePolicy="memory-disk"
            />
            {!stuck ? (
              <View style={styles.spinnerWrap}>
                <ActivityIndicator color="#FFFFFF" />
              </View>
            ) : null}
          </View>
        ) : null}
        {stuck ? (
          <Pressable
            style={styles.playButton}
            onPress={recover}
            accessibilityRole="button"
            accessibilityLabel="Play video"
          >
            <MaterialIcons name="play-arrow" size={34} color="#FFFFFF" />
          </Pressable>
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
  playButton: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    width: 64,
    height: 64,
    marginTop: -32,
    marginLeft: -32,
    borderRadius: 32,
    backgroundColor: 'rgba(0,0,0,0.72)',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
