import { requireSupabase } from '../../lib/supabase';
import type { HostedAsset } from '../../types/database';

/**
 * Client access to hosted-video playback.
 *
 * Playback URLs are NEVER stored in the database and never public:
 * the r2-playback Edge Function mints a short-lived (<= 15 min)
 * signed URL after checking, server-side, that the caller is a
 * signed-in member, the video is a published hosted video, its asset
 * is ready, and a content authorization exists. Callers must treat
 * the returned URL as perishable — fetch it when playback starts,
 * not ahead of time.
 */

export class HostedNotConfiguredError extends Error {
  constructor() {
    super('Hosted playback is not configured yet');
    this.name = 'HostedNotConfiguredError';
  }
}

interface PlaybackResponse {
  url?: string;
  expires_in?: number;
  error?: string;
  detail?: string;
}

/** Mint a fresh signed playback URL for a published hosted video. */
export async function fetchHostedPlaybackUrl(videoId: string): Promise<string> {
  // Direct-file assets (the phone-upload flow): when the asset's
  // playback key is the original file itself rather than an .m3u8
  // playlist, ask r2-playback for a signed URL for that one object —
  // the player streams the MP4/WebM progressively, no HLS transcode
  // step needed. Playlist assets keep the master-playlist flow.
  const asset = await fetchHostedAsset(videoId).catch(() => null);
  const directKey =
    asset?.hls_master_key && !asset.hls_master_key.endsWith('.m3u8')
      ? asset.hls_master_key
      : null;
  const supabase = requireSupabase();
  const { data, error } = await supabase.functions.invoke<PlaybackResponse>('r2-playback', {
    body: directKey ? { video_id: videoId, key: directKey } : { video_id: videoId },
  });
  if (error) {
    // supabase-js wraps non-2xx responses; the function's JSON body is
    // available via error.context on web/fetch runtimes. Read it when
    // present so R2_NOT_CONFIGURED maps to the honest message below.
    let code: string | undefined;
    try {
      const ctx = (error as { context?: Response }).context;
      if (ctx && typeof ctx.clone === 'function') {
        const parsed = (await ctx.clone().json()) as PlaybackResponse;
        code = parsed.error;
      }
    } catch {
      // Body unreadable — fall through to the generic mapping.
    }
    if (code === 'R2_NOT_CONFIGURED' || error.message.includes('R2_NOT_CONFIGURED')) {
      throw new HostedNotConfiguredError();
    }
    if (code === 'UNAUTHENTICATED' || error.message.includes('401')) {
      throw new Error('Sign in to watch this recording.');
    }
    throw new Error('This recording is not available right now. Please try again later.');
  }
  if (data?.error === 'R2_NOT_CONFIGURED') throw new HostedNotConfiguredError();
  if (!data?.url) {
    throw new Error('This recording is not available right now. Please try again later.');
  }
  return data.url;
}

/**
 * Probe-on-first-play self-heal (deep-research session-completion
 * model, 27 Nov 2026): when a player discovers a hosted video's real
 * duration and the catalogue row still has none, an ADMIN viewer's
 * app writes it back — sessions then complete at the true end
 * instead of playing past it or sitting black past the offset.
 * Best-effort and silent: members can't write (RLS), and any failure
 * is swallowed — playback never depends on this.
 */
export async function reportVideoDurationIfMissing(
  videoId: string,
  durationSeconds: number,
): Promise<void> {
  try {
    if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) return;
    const supabase = requireSupabase();
    const { data: video } = await supabase
      .from('videos')
      .select('duration_seconds')
      .eq('id', videoId)
      .maybeSingle();
    if (!video || video.duration_seconds != null) return;
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) return;
    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', auth.user.id)
      .maybeSingle();
    if (!profile || profile.role !== 'admin') return;
    await supabase
      .from('videos')
      .update({ duration_seconds: Math.round(durationSeconds) })
      .eq('id', videoId)
      .is('duration_seconds', null);
  } catch {
    // Self-heal only — never surface.
  }
}

/** The hosted asset row for a video (RLS: published-hosted or admin). */
export async function fetchHostedAsset(videoId: string): Promise<HostedAsset | null> {
  const supabase = requireSupabase();
  const { data, error } = await supabase
    .from('hosted_assets')
    .select('*')
    .eq('video_id', videoId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as HostedAsset | null) ?? null;
}
