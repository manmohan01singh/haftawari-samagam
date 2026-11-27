import React, {
  forwardRef,
  memo,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import { layout, lightColors } from '../../../theme';
import type { YouTubeEmbedHandle } from './YouTubeEmbed';

export type { YouTubeEmbedHandle };

interface YouTubeEmbedProps {
  youtubeVideoId: string;
  startSeconds: number;
  autoplay?: boolean;
  onTimeUpdate?: (seconds: number) => void;
  onReady?: () => void;
}

// react-native-web has no WebView; on web the official embed is a plain
// iframe. It is rendered with YouTube's DEFAULT controls and branding —
// nothing hidden or re-skinned. Sync uses the documented IFrame API
// postMessage protocol (enablejsapi=1): 'listening' handshake,
// infoDelivery currentTime reports, seekTo/playVideo/pauseVideo commands.
const Iframe = 'iframe' as unknown as React.ElementType;

export const YouTubeEmbed = memo(
  forwardRef<YouTubeEmbedHandle, YouTubeEmbedProps>(
  function YouTubeEmbed(
    { youtubeVideoId, startSeconds, autoplay = false, onTimeUpdate, onReady },
    ref,
  ) {
    // Freeze the start offset at mount (UX perf pass): the caller
    // passes a LIVE session offset that changes on every clock tick,
    // and the iframe src is built from it — without freezing, the src
    // changed every tick and the iframe reloaded, restarting playback.
    // The parent remounts this component (key = video + playing/
    // replay) whenever a genuinely new start is needed; drift after
    // mount is corrected through the seekTo handle, not the src.
    const [initialStartSeconds] = useState(() =>
      Math.max(0, Math.floor(startSeconds)),
    );
    // Loading facade (QA round 2 follow-through): until the player
    // inside the iframe reports 'ready', the embed area is bare
    // black. Show the video's real thumbnail + spinner instead —
    // pointer-events-none, removed the moment 'ready' arrives; it
    // never covers the player, controls or ads once playing.
    const [readyVideoId, setReadyVideoId] = useState<string | null>(null);
    const frameRef = useRef<{ contentWindow: Window | null } | null>(null);
    const callbacks = useRef({ onTimeUpdate, onReady });
    callbacks.current = { onTimeUpdate, onReady };
    const videoIdRef = useRef(youtubeVideoId);
    videoIdRef.current = youtubeVideoId;

    const command = (func: string, args: unknown[] = []) => {
      frameRef.current?.contentWindow?.postMessage(
        JSON.stringify({ event: 'command', func, args }),
        '*',
      );
    };

    useImperativeHandle(ref, () => ({
      seekTo: (seconds: number) => command('seekTo', [Math.max(0, Math.floor(seconds)), true]),
      play: () => command('playVideo'),
      pause: () => command('pauseVideo'),
    }));

    useEffect(() => {
      const onMessage = (event: MessageEvent) => {
        if (typeof event.data !== 'string') return;
        let parsed: { event?: string; info?: { currentTime?: number } };
        try {
          parsed = JSON.parse(event.data) as typeof parsed;
        } catch {
          return;
        }
        if (parsed.event === 'onReady') {
          setReadyVideoId(videoIdRef.current);
          callbacks.current.onReady?.();
        }
        if (
          parsed.event === 'infoDelivery' &&
          parsed.info &&
          typeof parsed.info.currentTime === 'number'
        ) {
          callbacks.current.onTimeUpdate?.(parsed.info.currentTime);
        }
      };
      window.addEventListener('message', onMessage);
      return () => window.removeEventListener('message', onMessage);
    }, []);

    const src =
      `https://www.youtube.com/embed/${encodeURIComponent(youtubeVideoId)}` +
      `?start=${initialStartSeconds}` +
      `&autoplay=${autoplay ? 1 : 0}&rel=0&enablejsapi=1&playsinline=1`;

    return (
      <View style={styles.wrap}>
        <Iframe
          ref={frameRef}
          src={src}
          title="YouTube video player"
          style={{ width: '100%', height: '100%', border: 0 }}
          allow="accelerometer; autoplay; encrypted-media; picture-in-picture; fullscreen"
          allowFullScreen
          onLoad={() => {
            frameRef.current?.contentWindow?.postMessage(
              JSON.stringify({ event: 'listening', id: 'session-player' }),
              '*',
            );
          }}
        />
        {readyVideoId !== youtubeVideoId ? (
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
  }),
);

const styles = StyleSheet.create({
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
  wrap: {
    width: '100%',
    aspectRatio: layout.thumbnailAspectRatio,
    backgroundColor: lightColors.playerBackground,
  },
});
