import { requireSupabase } from '../../lib/supabase';
import { validateVideoUrlOrId } from '../../lib/youtube';
import type {
  AuditLog,
  Category,
  ChatMessage,
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
  chatMessages: number;
  chatRemoved: number;
}

async function headCount(
  table: 'profiles' | 'categories' | 'chat_messages',
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

  const [videoStates, sessionStates, members, categories, chatMessages, chatRemoved] =
    await Promise.all([
      supabase.from('videos').select('publish_state'),
      supabase.from('sessions').select('status'),
      headCount('profiles'),
      headCount('categories'),
      headCount('chat_messages'),
      headCount('chat_messages', { column: 'is_removed', value: true }),
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
  youtube_video_id: string;
  thumbnail_url: string | null;
}

export interface SessionWithVideo extends SamagamSession {
  video: SessionVideoRef | null;
}

export async function listSessionsWithVideo(): Promise<SessionWithVideo[]> {
  const supabase = requireSupabase();
  const { data, error } = await supabase
    .from('sessions')
    .select('*, videos ( id, title, youtube_video_id, thumbnail_url )')
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
