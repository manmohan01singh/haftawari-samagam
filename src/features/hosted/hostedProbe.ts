import { createVideoPlayer } from 'expo-video';

/**
 * Read a local video file's duration (seconds) WITHOUT playing it —
 * the pattern the Expo SDK 58 docs describe: a player not connected
 * to any VideoView still loads the source and fills its metadata.
 * Used by the hosted-upload flow: the server cannot probe an R2
 * object's duration, and sessions derive their completion from the
 * catalogue's duration_seconds — an unprobed upload (null duration)
 * is what left a finished session claiming NOW PLAYING forever and
 * late joiners staring at a black player past the end of a short
 * recording (device report, 27 Nov 2026).
 *
 * Returns null when the duration cannot be determined (corrupt file,
 * timeout) — probing must never block an upload.
 */
export async function probeVideoDuration(uri: string): Promise<number | null> {
  let player: ReturnType<typeof createVideoPlayer> | null = null;
  try {
    const probe = createVideoPlayer(uri);
    player = probe;
    const duration = await new Promise<number | null>((resolve) => {
      const timeout = setTimeout(() => resolve(null), 20_000);
      let settled = false;
      const finish = (value: number | null) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        sub.remove();
        resolve(value);
      };
      const sub = probe.addListener('statusChange', ({ status }) => {
        if (status === 'readyToPlay') {
          finish(probe.duration > 0 ? probe.duration : null);
        } else if (status === 'error') {
          finish(null);
        }
      });
      if (probe.status === 'readyToPlay') {
        finish(probe.duration > 0 ? probe.duration : null);
      }
    });
    return duration;
  } catch {
    return null;
  } finally {
    try {
      player?.release();
    } catch {
      // Already released — probing stays best-effort.
    }
  }
}
