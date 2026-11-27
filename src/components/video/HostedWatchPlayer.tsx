import React, { forwardRef, useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { HostedPlayer, type HostedPlayerHandle } from './HostedPlayer';
import {
  fetchHostedPlaybackUrl,
  HostedNotConfiguredError,
  reportVideoDurationIfMissing,
} from '../../features/hosted/hostedService';
import { layout, spacing, useTheme, type ThemeColors } from '../../theme';

interface HostedWatchPlayerProps {
  videoId: string;
  thumbnailUrl: string | null;
  autoplay?: boolean;
  /** The player's own transport state, as it changes. */
  onPlayingChange?: (playing: boolean) => void;
  /** Phase E mini mode: bare video surface (see HostedPlayer). */
  mini?: boolean;
}

export type { HostedPlayerHandle };

/**
 * Watch-screen host for a hosted video: mints the short-lived signed
 * playback URL (r2-playback Edge Function) and renders HostedPlayer.
 * Failure states are honest — a not-yet-configured backend says so,
 * and a signed-out member is told to sign in (the function requires
 * a member session), instead of showing a dead black box.
 */
export const HostedWatchPlayer = forwardRef<HostedPlayerHandle, HostedWatchPlayerProps>(
  function HostedWatchPlayer({ videoId, thumbnailUrl, autoplay = true, onPlayingChange, mini = false }, ref) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  // State is keyed by videoId (same pattern as WatchScreen): a stale
  // entry for a previous video reads as 'loading', so the effect never
  // needs a synchronous setState to reset.
  const [stored, setStored] = useState<
    | { videoId: string; kind: 'ready'; url: string }
    | { videoId: string; kind: 'error'; message: string }
    | null
  >(null);
  const state: { kind: 'loading' } | { kind: 'ready'; url: string } | { kind: 'error'; message: string } =
    stored && stored.videoId === videoId ? stored : { kind: 'loading' };

  useEffect(() => {
    let active = true;
    fetchHostedPlaybackUrl(videoId)
      .then((url) => {
        if (active) setStored({ videoId, kind: 'ready', url });
      })
      .catch((e: unknown) => {
        if (!active) return;
        setStored({
          videoId,
          kind: 'error',
          message:
            e instanceof HostedNotConfiguredError
              ? 'Hosted playback is not configured yet. This recording cannot be played until the hosting setup is finished.'
              : e instanceof Error
                ? e.message
                : 'This recording is not available right now.',
        });
      });
    return () => {
      active = false;
    };
  }, [videoId]);

  // Silent re-mint for HostedPlayer's error recovery (long videos
  // outlive the 15-minute signed URL; see HostedPlayer.onRefreshUri).
  const refreshUri = useCallback(async (): Promise<string | null> => {
    try {
      return await fetchHostedPlaybackUrl(videoId);
    } catch {
      return null;
    }
  }, [videoId]);

  if (state.kind === 'ready') {
    return (
      <HostedPlayer
        ref={ref}
        uri={state.url}
        autoplay={autoplay}
        mini={mini}
        onPlayingChange={onPlayingChange}
        onRefreshUri={refreshUri}
        onDuration={(seconds) => void reportVideoDurationIfMissing(videoId, seconds)}
      />
    );
  }

  return (
    <View style={styles.wrap}>
      {thumbnailUrl ? (
        <Image
          source={{ uri: thumbnailUrl }}
          style={styles.poster}
          contentFit="cover"
          cachePolicy="memory-disk"
        />
      ) : (
        // No poster: the brand mark centred, like every card
        // fallback — a bare black void read as a broken page in
        // the mobile sweep (27 Nov 2026).
        <View style={styles.posterFallback}>
          <Image
            source={require('../../../assets/icon.png')}
            style={styles.posterFallbackMark}
            contentFit="contain"
          />
        </View>
      )}
      <View style={styles.center}>
        {state.kind === 'loading' ? (
          <ActivityIndicator color="#FFFFFF" />
        ) : (
          <Text style={styles.message}>{state.message}</Text>
        )}
      </View>
    </View>
  );
});

const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    wrap: {
      width: '100%',
      aspectRatio: layout.thumbnailAspectRatio,
      backgroundColor: colors.playerBackground,
    },
    poster: { width: '100%', height: '100%' },
    posterFallback: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      alignItems: 'center',
      justifyContent: 'center',
    },
    posterFallbackMark: { width: 72, height: 72, opacity: 0.9 },
    center: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      alignItems: 'center',
      justifyContent: 'center',
      padding: spacing.lg,
    },
    message: { color: '#FFFFFF', fontSize: 14, textAlign: 'center' },
  });
