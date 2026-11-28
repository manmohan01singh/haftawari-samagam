import { requireSupabase } from '../../lib/supabase';
import { fetchChannelById, validateVideoUrlOrId, type YouTubeChannelInfo } from '../../lib/youtube';
import type {
  AuditLog,
  Category,
  ChannelRecord,
  ChatMessage,
  ContentAuthorization,
  HostedAsset,
  HostedAssetStatus,
  Profile,
  PublishState,
  SamagamSession,
  SessionStatus,
  Video,
} from '../../types/database';

/**
 * Admin data service — every call goes through the anon-key Supabase
 * client signed in as the admin user. Row Level Security
 * (`public.is_admin()`) is the enforcement: these functions contain no
 * privileged key and no bypass. If the caller is not an admin, the
 * database itself rejects the writes (verified: anon INSERT into
 * `videos` returns HTTP 401, code 42501).
 *
 * Every mutating function also appends an `audit_logs` entry with
 * actor = the acting admin, as required by the dashboard spec. The
 * audit insert runs AFTER the main write; if it fails, the error
 * message says the action itself already succeeded.
 */

// ── Audit ────────────────────────────────────────────────────────────

async function writeAuditLog(
  actorId: string,
  action: string,
  entityType: string,
  entityId: string | null,
  details?: Record<string, unknown>,
): Promise<void> {
  const supabase = requireSupabase();
  const { error } = await supabase.from('audit_logs').insert({
    actor_id: actorId,
    action,
    entity_type: entityType,
    entity_id: entityId,
    details: details ?? null,
  });
  if (error) {
    throw new Error(
      `The action succeeded, but writing the audit log failed: ${error.message}`,
    );
  }
}

// ── Profiles / gate ──────────────────────────────────────────────────

export async function fetchOwnProfile(userId: string): Promise<Profile | null> {
  const supabase = requireSupabase();
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .maybeSingle();
  if (error) throw error;
  return (data as Profile | null) ?? null;
}

export async function fetchProfilesByIds(ids: string[]): Promise<Map<string, Profile>> {
  const map = new Map<string, Profile>();
  if (ids.length === 0) return map;
  const supabase = requireSupabase();
  const { data, error } = await supabase.from('profiles').select('*').in('id', ids);
  if (error) throw error;
  for (const row of (data ?? []) as Profile[]) map.set(row.id, row);
  return map;
}

// ── Overview ─────────────────────────────────────────────────────────

export interface OverviewCounts {
  videosTotal: number;
  videosPublished: number;
  videosDraft: number;
  videosUnpublished: number;
  sessionsTotal: number;
  sessionsByStatus: Record<SessionStatus, number>;
  members: number;
  categories: number;
  channelsTotal: number;
  channelsActive: number;
  chatMessages: number;
  chatRemoved: number;
}

async function headCount(
  table: 'profiles' | 'categories' | 'chat_messages' | 'channels',
  filter?: { column: string; value: string | boolean },
): Promise<number> {
  const supabase = requireSupabase();
  let query = supabase.from(table).select('id', { count: 'exact', head: true });
  if (filter) query = query.eq(filter.column, filter.value);
  const { count, error } = await query;
  if (error) throw error;
  return count ?? 0;
}

export async function fetchOverviewCounts(): Promise<OverviewCounts> {
  const supabase = requireSupabase();

  const [videoStates, sessionStates, members, categories, chatMessages, chatRemoved, channelsTotal, channelsActive] =
    await Promise.all([
      supabase.from('videos').select('publish_state'),
      supabase.from('sessions').select('status'),
      headCount('profiles'),
      headCount('categories'),
      headCount('chat_messages'),
      headCount('chat_messages', { column: 'is_removed', value: true }),
      headCount('channels').catch(() => 0),
      headCount('channels', { column: 'is_active', value: true }).catch(() => 0),
    ]);
  if (videoStates.error) throw videoStates.error;
  if (sessionStates.error) throw sessionStates.error;

  const videosByState: Record<PublishState, number> = {
    draft: 0,
    published: 0,
    unpublished: 0,
  };
  for (const row of (videoStates.data ?? []) as { publish_state: PublishState }[]) {
    videosByState[row.publish_state] += 1;
  }
  const sessionsByStatus: Record<SessionStatus, number> = {
    upcoming: 0,
    now_playing: 0,
    completed: 0,
    cancelled: 0,
  };
  for (const row of (sessionStates.data ?? []) as { status: SessionStatus }[]) {
    sessionsByStatus[row.status] += 1;
  }

  return {
    videosTotal: videosByState.draft + videosByState.published + videosByState.unpublished,
    videosPublished: videosByState.published,
    videosDraft: videosByState.draft,
    videosUnpublished: videosByState.unpublished,
    sessionsTotal:
      sessionsByStatus.upcoming +
      sessionsByStatus.now_playing +
      sessionsByStatus.completed +
      sessionsByStatus.cancelled,
    sessionsByStatus,
    members,
    categories,
    chatMessages,
    chatRemoved,
    channelsTotal,
    channelsActive,
  };
}

// ── Videos ───────────────────────────────────────────────────────────

export async function listAllVideos(): Promise<Video[]> {
  const supabase = requireSupabase();
  const { data, error } = await supabase
    .from('videos')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as Video[];
}

/** Parse an ISO-8601 duration ("PT2H23M19S") into whole seconds. */
export function parseIso8601Duration(iso: string): number | null {
  const match =
    /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/.exec(iso.trim());
  if (!match) return null;
  const days = Number(match[1] ?? 0);
  const hours = Number(match[2] ?? 0);
  const minutes = Number(match[3] ?? 0);
  const seconds = Number(match[4] ?? 0);
  return days * 86400 + hours * 3600 + minutes * 60 + Math.round(seconds);
}

/**
 * Add a video from a pasted YouTube URL / id. Metadata (title,
 * description, thumbnail, duration) comes from the official YouTube
 * Data API — never typed in by hand, never scraped. New videos always
 * start as drafts; publishing is a separate deliberate action.
 */
export async function addVideoFromYouTube(input: string, actorId: string): Promise<Video> {
  const metadata = await validateVideoUrlOrId(input);
  if (!metadata) {
    throw new Error(
      'No YouTube video was found for that link or ID. Check the link and try again — nothing was saved.',
    );
  }
  const supabase = requireSupabase();
  const { data, error } = await supabase
    .from('videos')
    .insert({
      youtube_video_id: metadata.youtubeVideoId,
      title: metadata.title,
      description: metadata.description || null,
      thumbnail_url: metadata.thumbnailUrl,
      duration_seconds: parseIso8601Duration(metadata.durationIso8601),
      publish_state: 'draft' as PublishState,
      created_by: actorId,
    })
    .select('*')
    .single();
  if (error) {
    if (error.code === '23505') {
      throw new Error(
        `"${metadata.title}" is already in the library (YouTube ID ${metadata.youtubeVideoId}).`,
      );
    }
    throw error;
  }
  const video = data as Video;
  await writeAuditLog(actorId, 'video.add', 'video', video.id, {
    youtube_video_id: video.youtube_video_id,
    title: video.title,
  });
  return video;
}

export async function setVideoPublishState(
  video: Video,
  next: 'published' | 'unpublished',
  actorId: string,
): Promise<Video> {
  const supabase = requireSupabase();
  const { data, error } = await supabase
    .from('videos')
    .update({
      publish_state: next,
      published_at: next === 'published' ? new Date().toISOString() : video.published_at,
      updated_at: new Date().toISOString(),
    })
    .eq('id', video.id)
    .select('*')
    .single();
  if (error) throw error;
  const updated = data as Video;
  await writeAuditLog(
    actorId,
    next === 'published' ? 'video.publish' : 'video.unpublish',
    'video',
    updated.id,
    { youtube_video_id: updated.youtube_video_id, title: updated.title },
  );
  return updated;
}

export async function setVideoCategory(
  video: Video,
  categoryId: string | null,
  categoryName: string | null,
  actorId: string,
): Promise<Video> {
  const supabase = requireSupabase();
  const { data, error } = await supabase
    .from('videos')
    .update({ category_id: categoryId, updated_at: new Date().toISOString() })
    .eq('id', video.id)
    .select('*')
    .single();
  if (error) throw error;
  const updated = data as Video;
  await writeAuditLog(actorId, 'video.set_category', 'video', updated.id, {
    youtube_video_id: updated.youtube_video_id,
    category_id: categoryId,
    category_name: categoryName,
  });
  return updated;
}

/**
 * Set a video's duration (seconds). Hosted uploads probe the file's
 * real duration on the admin's device at pick time (the server cannot
 * probe an R2 object); sessions derive their completion from this —
 * a null duration is what left a finished session claiming NOW
 * PLAYING forever (device report, 27 Nov 2026).
 */
export async function setVideoDuration(
  videoId: string,
  durationSeconds: number,
  actorId: string,
): Promise<void> {
  const supabase = requireSupabase();
  const { error } = await supabase
    .from('videos')
    .update({ duration_seconds: Math.round(durationSeconds), updated_at: new Date().toISOString() })
    .eq('id', videoId);
  if (error) throw error;
  await writeAuditLog(actorId, 'video.set_duration', 'video', videoId, {
    duration_seconds: Math.round(durationSeconds),
  });
}

/**
 * Set a video's thumbnail. Hosted videos have no YouTube thumbnail to
 * borrow, so the admin uploads one (stored as a compressed JPEG data
 * URI — the catalogue holds essentially one hosted video at a time,
 * so no separate image host is needed).
 */
export async function setVideoThumbnail(
  videoId: string,
  thumbnailDataUri: string,
  actorId: string,
): Promise<void> {
  const supabase = requireSupabase();
  const { error } = await supabase
    .from('videos')
    .update({ thumbnail_url: thumbnailDataUri, updated_at: new Date().toISOString() })
    .eq('id', videoId);
  if (error) throw error;
  await writeAuditLog(actorId, 'video.set_thumbnail', 'video', videoId, {});
}

export async function deleteVideo(video: Video, actorId: string): Promise<void> {
  const supabase = requireSupabase();
  const { error } = await supabase.from('videos').delete().eq('id', video.id);
  if (error) throw error;
  await writeAuditLog(actorId, 'video.delete', 'video', video.id, {
    youtube_video_id: video.youtube_video_id,
    title: video.title,
  });
}

// ── Sessions ─────────────────────────────────────────────────────────

export interface SessionVideoRef {
  id: string;
  title: string;
  /** NULL for hosted videos (migration 0005). */
  youtube_video_id: string | null;
  thumbnail_url: string | null;
  duration_seconds: number | null;
}

export interface SessionWithVideo extends SamagamSession {
  video: SessionVideoRef | null;
}

export async function listSessionsWithVideo(): Promise<SessionWithVideo[]> {
  const supabase = requireSupabase();
  const { data, error } = await supabase
    .from('sessions')
    .select('*, videos ( id, title, youtube_video_id, thumbnail_url, duration_seconds )')
    .order('scheduled_start_at', { ascending: false });
  if (error) throw error;
  return ((data ?? []) as (SamagamSession & { videos: SessionVideoRef | null })[]).map(
    (row) => {
      const { videos, ...session } = row;
      return { ...session, video: videos ?? null };
    },
  );
}

export async function listPublishedVideos(): Promise<Video[]> {
  const supabase = requireSupabase();
  const { data, error } = await supabase
    .from('videos')
    .select('*')
    .eq('publish_state', 'published')
    .order('title', { ascending: true });
  if (error) throw error;
  return (data ?? []) as Video[];
}

export async function createSession(
  input: {
    videoId: string;
    title: string | null;
    scheduledStartAt: string; // ISO 8601
    scheduledEndAt: string | null; // ISO 8601
  },
  actorId: string,
): Promise<SamagamSession> {
  const supabase = requireSupabase();
  // Duplicate guard (audit P2, 28 Nov 2026): the twin-session
  // incident (two sessions for the same video 4 s apart) happened
  // AFTER the first submit completed, so the form's busy flag could
  // never catch it. Refuse a second non-cancelled session for the
  // same video at the same start time.
  const { data: existing, error: dupError } = await supabase
    .from('sessions')
    .select('id')
    .eq('video_id', input.videoId)
    .eq('scheduled_start_at', input.scheduledStartAt)
    .neq('status', 'cancelled')
    .limit(1);
  if (dupError) throw dupError;
  if (existing && existing.length > 0) {
    throw new Error(
      'A session for this video at this start time already exists — not creating a duplicate.',
    );
  }
  const { data, error } = await supabase
    .from('sessions')
    .insert({
      video_id: input.videoId,
      title: input.title,
      scheduled_start_at: input.scheduledStartAt,
      scheduled_end_at: input.scheduledEndAt,
      status: 'upcoming' as SessionStatus,
      created_by: actorId,
    })
    .select('*')
    .single();
  if (error) throw error;
  const session = data as SamagamSession;
  await writeAuditLog(actorId, 'session.create', 'session', session.id, {
    video_id: session.video_id,
    title: session.title,
    scheduled_start_at: session.scheduled_start_at,
    scheduled_end_at: session.scheduled_end_at,
  });
  return session;
}

/**
 * Change a session's own title (Phase 13). The sessions.title column
 * has existed since 0001 and the create form already writes it; this
 * is the EDIT path for sessions that already exist. An empty title
 * clears back to null (screens fall back to the recording's title).
 * RLS (sessions_admin_write) enforces admin-only server-side.
 */
export async function updateSessionTitle(
  session: SamagamSession,
  title: string | null,
  actorId: string,
): Promise<void> {
  const supabase = requireSupabase();
  const { error } = await supabase
    .from('sessions')
    .update({ title, updated_at: new Date().toISOString() })
    .eq('id', session.id);
  if (error) throw error;
  await writeAuditLog(actorId, 'session.update_title', 'session', session.id, {
    video_id: session.video_id,
    title,
    scheduled_start_at: session.scheduled_start_at,
  });
}

export async function cancelSession(session: SamagamSession, actorId: string): Promise<void> {
  const supabase = requireSupabase();
  const { error } = await supabase
    .from('sessions')
    .update({ status: 'cancelled' as SessionStatus, updated_at: new Date().toISOString() })
    .eq('id', session.id);
  if (error) throw error;
  await writeAuditLog(actorId, 'session.cancel', 'session', session.id, {
    video_id: session.video_id,
    title: session.title,
    scheduled_start_at: session.scheduled_start_at,
  });
}

// ── Categories ───────────────────────────────────────────────────────

export async function listCategories(): Promise<Category[]> {
  const supabase = requireSupabase();
  const { data, error } = await supabase
    .from('categories')
    .select('*')
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true });
  if (error) throw error;
  return (data ?? []) as Category[];
}

export function slugifyCategoryName(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export async function createCategory(name: string, actorId: string): Promise<Category> {
  const slug = slugifyCategoryName(name);
  if (!slug) {
    throw new Error('The category name must contain at least one letter or number.');
  }
  const existing = await listCategories();
  const nextOrder = existing.reduce((max, c) => Math.max(max, c.sort_order), -1) + 1;
  const supabase = requireSupabase();
  const { data, error } = await supabase
    .from('categories')
    .insert({ slug, name: name.trim(), sort_order: nextOrder })
    .select('*')
    .single();
  if (error) {
    if (error.code === '23505') {
      throw new Error(`A category with the slug "${slug}" already exists.`);
    }
    throw error;
  }
  const category = data as Category;
  await writeAuditLog(actorId, 'category.create', 'category', category.id, {
    slug: category.slug,
    name: category.name,
  });
  return category;
}

export async function renameCategory(
  category: Category,
  newName: string,
  actorId: string,
): Promise<Category> {
  const supabase = requireSupabase();
  const { data, error } = await supabase
    .from('categories')
    .update({ name: newName.trim() })
    .eq('id', category.id)
    .select('*')
    .single();
  if (error) throw error;
  const updated = data as Category;
  await writeAuditLog(actorId, 'category.rename', 'category', updated.id, {
    slug: updated.slug,
    from: category.name,
    to: updated.name,
  });
  return updated;
}

/** Swap sort_order with the neighbour in the given direction. */
export async function moveCategory(
  category: Category,
  neighbour: Category,
  actorId: string,
): Promise<void> {
  const supabase = requireSupabase();
  const first = await supabase
    .from('categories')
    .update({ sort_order: neighbour.sort_order })
    .eq('id', category.id);
  if (first.error) throw first.error;
  const second = await supabase
    .from('categories')
    .update({ sort_order: category.sort_order })
    .eq('id', neighbour.id);
  if (second.error) throw second.error;
  await writeAuditLog(actorId, 'category.reorder', 'category', category.id, {
    slug: category.slug,
    from_order: category.sort_order,
    to_order: neighbour.sort_order,
    swapped_with: neighbour.slug,
  });
}

export async function deleteCategory(category: Category, actorId: string): Promise<void> {
  const supabase = requireSupabase();
  const { error } = await supabase.from('categories').delete().eq('id', category.id);
  if (error) throw error;
  await writeAuditLog(actorId, 'category.delete', 'category', category.id, {
    slug: category.slug,
    name: category.name,
  });
}

// ── Members ──────────────────────────────────────────────────────────

export async function listMembers(): Promise<Profile[]> {
  const supabase = requireSupabase();
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data ?? []) as Profile[];
}

// ── Chat moderation ──────────────────────────────────────────────────

export async function listChatMessages(
  sessionId: string,
  limit = 100,
): Promise<ChatMessage[]> {
  const supabase = requireSupabase();
  const { data, error } = await supabase
    .from('chat_messages')
    .select('*')
    .eq('session_id', sessionId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as ChatMessage[];
}

export async function setChatMessageRemoved(
  message: ChatMessage,
  removed: boolean,
  actorId: string,
): Promise<void> {
  const supabase = requireSupabase();
  const { error } = await supabase
    .from('chat_messages')
    .update({ is_removed: removed })
    .eq('id', message.id);
  if (error) throw error;
  await writeAuditLog(
    actorId,
    removed ? 'chat.remove_message' : 'chat.restore_message',
    'chat_message',
    message.id,
    { session_id: message.session_id, user_id: message.user_id },
  );
}

// ── Channels (multi-channel panel, migration 0003) ───────────────────

/** All panel channels (active + inactive), in admin-chosen order. */
export async function listAllChannels(): Promise<ChannelRecord[]> {
  const supabase = requireSupabase();
  const { data, error } = await supabase
    .from('channels')
    .select('*')
    .order('sort_order', { ascending: true })
    .order('title', { ascending: true });
  if (error) throw error;
  return (data ?? []) as ChannelRecord[];
}

/**
 * Add a channel the admin resolved through the YouTube API (the panel
 * shows the resolved title/avatar/counts BEFORE this runs — nothing is
 * saved from typed-in text). Title/avatar/handle saved here are the
 * API's own values from that resolution.
 */
export async function addChannel(
  info: YouTubeChannelInfo,
  aliases: string[],
  actorId: string,
): Promise<ChannelRecord> {
  const existing = await listAllChannels();
  const nextOrder = existing.reduce((max, c) => Math.max(max, c.sort_order), -1) + 1;
  const supabase = requireSupabase();
  const { data, error } = await supabase
    .from('channels')
    .insert({
      youtube_channel_id: info.channelId,
      handle: info.handle,
      title: info.title,
      avatar_url: info.avatarUrl,
      aliases,
      is_active: true,
      sort_order: nextOrder,
      created_by: actorId,
    })
    .select('*')
    .single();
  if (error) {
    if (error.code === '23505') {
      throw new Error(`"${info.title}" is already in the panel.`);
    }
    throw error;
  }
  const channel = data as ChannelRecord;
  await writeAuditLog(actorId, 'channel.add', 'channel', channel.id, {
    youtube_channel_id: channel.youtube_channel_id,
    handle: channel.handle,
    title: channel.title,
  });
  return channel;
}

export async function setChannelActive(
  channel: ChannelRecord,
  active: boolean,
  actorId: string,
): Promise<ChannelRecord> {
  const supabase = requireSupabase();
  const { data, error } = await supabase
    .from('channels')
    .update({ is_active: active, updated_at: new Date().toISOString() })
    .eq('id', channel.id)
    .select('*')
    .single();
  if (error) throw error;
  const updated = data as ChannelRecord;
  await writeAuditLog(
    actorId,
    active ? 'channel.activate' : 'channel.deactivate',
    'channel',
    updated.id,
    { youtube_channel_id: updated.youtube_channel_id, title: updated.title },
  );
  return updated;
}

/** Swap sort_order with the neighbour in the given direction. */
export async function moveChannel(
  channel: ChannelRecord,
  neighbour: ChannelRecord,
  actorId: string,
): Promise<void> {
  const supabase = requireSupabase();
  const first = await supabase
    .from('channels')
    .update({ sort_order: neighbour.sort_order, updated_at: new Date().toISOString() })
    .eq('id', channel.id);
  if (first.error) throw first.error;
  const second = await supabase
    .from('channels')
    .update({ sort_order: channel.sort_order, updated_at: new Date().toISOString() })
    .eq('id', neighbour.id);
  if (second.error) throw second.error;
  await writeAuditLog(actorId, 'channel.reorder', 'channel', channel.id, {
    youtube_channel_id: channel.youtube_channel_id,
    from_order: channel.sort_order,
    to_order: neighbour.sort_order,
    swapped_with: neighbour.youtube_channel_id,
  });
}

/** Re-read title/handle/avatar from the YouTube API and save the fresh snapshot. */
export async function refreshChannel(
  channel: ChannelRecord,
  actorId: string,
): Promise<ChannelRecord> {
  const info = await fetchChannelById(channel.youtube_channel_id);
  if (!info) {
    throw new Error('YouTube did not return this channel — it may have been removed or made private.');
  }
  const supabase = requireSupabase();
  const { data, error } = await supabase
    .from('channels')
    .update({
      title: info.title,
      handle: info.handle,
      avatar_url: info.avatarUrl,
      updated_at: new Date().toISOString(),
    })
    .eq('id', channel.id)
    .select('*')
    .single();
  if (error) throw error;
  const updated = data as ChannelRecord;
  await writeAuditLog(actorId, 'channel.refresh', 'channel', updated.id, {
    youtube_channel_id: updated.youtube_channel_id,
    title: updated.title,
  });
  return updated;
}

export async function deleteChannel(channel: ChannelRecord, actorId: string): Promise<void> {
  const supabase = requireSupabase();
  const { error } = await supabase.from('channels').delete().eq('id', channel.id);
  if (error) throw error;
  await writeAuditLog(actorId, 'channel.remove', 'channel', channel.id, {
    youtube_channel_id: channel.youtube_channel_id,
    handle: channel.handle,
    title: channel.title,
  });
}

// ── Audit logs ───────────────────────────────────────────────────────

export async function listAuditLogs(limit = 100): Promise<AuditLog[]> {
  const supabase = requireSupabase();
  const { data, error } = await supabase
    .from('audit_logs')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as AuditLog[];
}

// ── Hosted videos (dual-source, migration 0005) ─────────────────────
// Hosted recordings are ORIGINALS supplied by the rights holder —
// never downloaded or extracted from YouTube. Publishing one is
// gated STRUCTURALLY in the database: the videos_hosted_publish_gate
// trigger refuses publish_state='published' for a hosted video with
// no content_authorizations row. The UI mirrors that gate (Publish
// disabled until an authorization is saved) but the trigger is the
// enforcement.


export interface HostedVideoBundle {
  video: Video;
  asset: HostedAsset | null;
  authorizations: ContentAuthorization[];
}

export async function createHostedVideoDraft(
  input: { title: string; description: string | null },
  actorId: string,
): Promise<Video> {
  const supabase = requireSupabase();
  const { data, error } = await supabase
    .from('videos')
    .insert({
      source: 'hosted',
      youtube_video_id: null,
      title: input.title,
      description: input.description,
      publish_state: 'draft' as PublishState,
      created_by: actorId,
    })
    .select('*')
    .single();
  if (error) throw error;
  const video = data as Video;
  await writeAuditLog(actorId, 'hosted.video_create', 'video', video.id, { title: video.title });
  return video;
}

export async function listHostedVideoBundles(): Promise<HostedVideoBundle[]> {
  const supabase = requireSupabase();
  const { data: videos, error } = await supabase
    .from('videos')
    .select('*')
    .eq('source', 'hosted')
    .order('created_at', { ascending: false });
  if (error) throw error;
  const list = (videos ?? []) as Video[];
  if (list.length === 0) return [];
  const ids = list.map((v) => v.id);
  const [assetsRes, authzRes] = await Promise.all([
    supabase.from('hosted_assets').select('*').in('video_id', ids),
    supabase.from('content_authorizations').select('*').in('video_id', ids).order('created_at', { ascending: false }),
  ]);
  if (assetsRes.error) throw assetsRes.error;
  if (authzRes.error) throw authzRes.error;
  const assetByVideo = new Map<string, HostedAsset>();
  for (const a of (assetsRes.data ?? []) as HostedAsset[]) assetByVideo.set(a.video_id, a);
  const authzByVideo = new Map<string, ContentAuthorization[]>();
  for (const a of (authzRes.data ?? []) as ContentAuthorization[]) {
    const arr = authzByVideo.get(a.video_id) ?? [];
    arr.push(a);
    authzByVideo.set(a.video_id, arr);
  }
  return list.map((video) => ({
    video,
    asset: assetByVideo.get(video.id) ?? null,
    authorizations: authzByVideo.get(video.id) ?? [],
  }));
}

export async function saveContentAuthorization(
  videoId: string,
  input: {
    rightsHolder: string;
    permissionNote: string;
    permissionReference: string | null;
    permissionDate: string; // YYYY-MM-DD
  },
  actorId: string,
): Promise<ContentAuthorization> {
  const supabase = requireSupabase();
  const { data, error } = await supabase
    .from('content_authorizations')
    .insert({
      video_id: videoId,
      rights_holder: input.rightsHolder,
      permission_note: input.permissionNote,
      permission_reference: input.permissionReference,
      permission_date: input.permissionDate,
      recorded_by: actorId,
    })
    .select('*')
    .single();
  if (error) throw error;
  const authz = data as ContentAuthorization;
  await writeAuditLog(actorId, 'hosted.authorization_record', 'content_authorization', authz.id, {
    video_id: videoId,
    rights_holder: authz.rights_holder,
    permission_date: authz.permission_date,
  });
  return authz;
}

export async function upsertHostedAsset(
  videoId: string,
  input: {
    r2ObjectKey: string;
    originalFilename: string | null;
    contentType: string | null;
    sizeBytes: number | null;
  },
  actorId: string,
): Promise<HostedAsset> {
  const supabase = requireSupabase();
  const { data, error } = await supabase
    .from('hosted_assets')
    .upsert(
      {
        video_id: videoId,
        r2_object_key: input.r2ObjectKey,
        original_filename: input.originalFilename,
        content_type: input.contentType,
        size_bytes: input.sizeBytes,
        status: 'uploaded' as HostedAssetStatus,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'video_id' },
    )
    .select('*')
    .single();
  if (error) throw error;
  const asset = data as HostedAsset;
  await writeAuditLog(actorId, 'hosted.asset_uploaded', 'hosted_asset', asset.id, {
    video_id: videoId,
    r2_object_key: asset.r2_object_key,
    size_bytes: asset.size_bytes,
  });
  return asset;
}

export async function updateHostedAsset(
  asset: HostedAsset,
  patch: {
    status?: HostedAssetStatus;
    hlsMasterKey?: string | null;
    durationSeconds?: number | null;
    publishAt?: string | null;
    expiresAt?: string | null;
    replacementOf?: string | null;
  },
  actorId: string,
): Promise<HostedAsset> {
  const supabase = requireSupabase();
  const row: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.status !== undefined) row.status = patch.status;
  if (patch.hlsMasterKey !== undefined) row.hls_master_key = patch.hlsMasterKey;
  if (patch.durationSeconds !== undefined) row.duration_seconds = patch.durationSeconds;
  if (patch.publishAt !== undefined) row.publish_at = patch.publishAt;
  if (patch.expiresAt !== undefined) row.expires_at = patch.expiresAt;
  if (patch.replacementOf !== undefined) row.replacement_of = patch.replacementOf;
  const { data, error } = await supabase
    .from('hosted_assets')
    .update(row)
    .eq('id', asset.id)
    .select('*')
    .single();
  if (error) throw error;
  const updated = data as HostedAsset;
  await writeAuditLog(actorId, 'hosted.asset_update', 'hosted_asset', updated.id, {
    video_id: updated.video_id,
    patch,
  });
  return updated;
}

/** Invoke the r2-admin Edge Function (delete / replace) with honest error mapping. */
export async function invokeR2Admin(
  action: 'delete' | 'replace',
  assetId: string,
  confirmOnlyCopy = false,
): Promise<{ deletedObjects?: number }> {
  const supabase = requireSupabase();
  const { data, error } = await supabase.functions.invoke<{
    ok?: boolean;
    deleted_objects?: number;
    error?: string;
    detail?: string;
  }>('r2-admin', { body: { action, asset_id: assetId, confirm_only_copy: confirmOnlyCopy } });
  if (error) {
    let code: string | undefined;
    let detail: string | undefined;
    try {
      const ctx = (error as { context?: Response }).context;
      if (ctx && typeof ctx.clone === 'function') {
        const parsed = (await ctx.clone().json()) as { error?: string; detail?: string };
        code = parsed.error;
        detail = parsed.detail;
      }
    } catch {
      // fall through
    }
    if (code === 'R2_NOT_CONFIGURED') {
      throw new Error('Hosting is not configured yet (R2_NOT_CONFIGURED) — the Cloudflare R2 setup has not been finished, so nothing was deleted.');
    }
    if (code) throw new Error(detail ? `${code}: ${detail}` : code);
    throw error;
  }
  if (data?.error) throw new Error(data.detail ? `${data.error}: ${data.detail}` : data.error);
  return { deletedObjects: data?.deleted_objects };
}

/** Server-measured facts about an R2 object (r2-upload verify-object). */
export interface HostedObjectVerification {
  sizeBytes: number;
  contentType: string | null;
}

/**
 * Ask the r2-upload Edge Function to HEAD the object in R2 and report
 * its SERVER-measured size/type. Client-claimed size/type (whatever
 * the browser said at upload time) are never trusted — this is the
 * only measurement allowed to land on the asset row before 'ready'.
 * Error mapping mirrors invokeR2Admin: honest codes, no silent pass.
 */
async function invokeVerifyObject(r2ObjectKey: string): Promise<HostedObjectVerification> {
  const supabase = requireSupabase();
  const { data, error } = await supabase.functions.invoke<{
    exists?: boolean;
    size_bytes?: number;
    content_type?: string | null;
    error?: string;
    detail?: string;
  }>('r2-upload', { body: { action: 'verify-object', key: r2ObjectKey } });
  if (error) {
    let code: string | undefined;
    let detail: string | undefined;
    try {
      const ctx = (error as { context?: Response }).context;
      if (ctx && typeof ctx.clone === 'function') {
        const parsed = (await ctx.clone().json()) as { error?: string; detail?: string };
        code = parsed.error;
        detail = parsed.detail;
      }
    } catch {
      // fall through
    }
    if (code === 'R2_NOT_CONFIGURED') {
      throw new Error('Hosting is not configured yet (R2_NOT_CONFIGURED) — finish the Cloudflare R2 setup before verifying an upload.');
    }
    if (code === 'OBJECT_NOT_FOUND') {
      throw new Error('Verification failed: the uploaded object was not found in R2 (OBJECT_NOT_FOUND). Re-upload the original file.');
    }
    if (code === 'FILE_TOO_LARGE') {
      throw new Error('Verification failed: the object in R2 is larger than the 8 GiB cap (FILE_TOO_LARGE).');
    }
    if (code === 'UNSUPPORTED_MEDIA_TYPE') {
      throw new Error('Verification failed: the object in R2 is not an MP4, WebM or QuickTime video (UNSUPPORTED_MEDIA_TYPE).');
    }
    if (code === 'CONTENT_SIGNATURE_MISMATCH') {
      throw new Error("Verification failed: the file's opening bytes do not match its video type (CONTENT_SIGNATURE_MISMATCH). It may be renamed or corrupt — re-upload the true original.");
    }
    if (code === 'CONTENT_SIGNATURE_CHECK_FAILED') {
      throw new Error('Verification failed: the opening bytes of the object could not be read from R2 (CONTENT_SIGNATURE_CHECK_FAILED). Try again.');
    }
    if (code) throw new Error(detail ? `${code}: ${detail}` : code);
    throw error;
  }
  if (data?.error) throw new Error(data.detail ? `${data.error}: ${data.detail}` : data.error);
  if (!data?.exists || typeof data.size_bytes !== 'number') {
    throw new Error('Verification failed: the upload signer returned no measurement for this object.');
  }
  return { sizeBytes: data.size_bytes, contentType: data.content_type ?? null };
}

/**
 * Verify an asset's R2 object server-side and overwrite the row's
 * size_bytes (and content_type, when R2 reports one) with the
 * SERVER-measured values. Throws — with nothing written — when the
 * object is missing, oversized or of a disallowed type. The admin UI
 * runs this before an asset may be marked 'ready'.
 */
export async function verifyHostedAsset(assetId: string, actorId: string): Promise<HostedAsset> {
  const supabase = requireSupabase();
  const { data: row, error: fetchError } = await supabase
    .from('hosted_assets')
    .select('*')
    .eq('id', assetId)
    .single();
  if (fetchError) throw fetchError;
  const asset = row as HostedAsset;

  const measured = await invokeVerifyObject(asset.r2_object_key);

  const patch: Record<string, unknown> = {
    size_bytes: measured.sizeBytes,
    updated_at: new Date().toISOString(),
  };
  if (measured.contentType) patch.content_type = measured.contentType;
  const { data, error } = await supabase
    .from('hosted_assets')
    .update(patch)
    .eq('id', asset.id)
    .select('*')
    .single();
  if (error) throw error;
  const updated = data as HostedAsset;
  await writeAuditLog(actorId, 'hosted.asset_verify', 'hosted_asset', updated.id, {
    video_id: updated.video_id,
    r2_object_key: updated.r2_object_key,
    size_bytes: updated.size_bytes,
    content_type: updated.content_type,
  });
  return updated;
}
