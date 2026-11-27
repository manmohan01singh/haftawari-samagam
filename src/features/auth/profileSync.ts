import type { User } from '@supabase/supabase-js';
import { supabase } from '../../lib/supabase';
import type { Profile } from '../../types/database';

/**
 * Profile sync from auth user metadata — this is what makes a real
 * Google DP show up in the app.
 *
 * On Google sign-in, Supabase puts the Google identity on the auth
 * user: user_metadata.avatar_url (or .picture) and .full_name (or
 * .name). The `profiles` row, by contrast, is what the rest of the
 * app reads (and what RLS reasons about). This module bridges the
 * two:
 *
 * - extractMetadataProfile: read the metadata values (also covers
 *   the `display_name` an email sign-up passes explicitly).
 * - mergeProfileWithMetadata: the profile the UI should use right
 *   now. Before migration 0004 is applied the row has no avatar_url
 *   column at all, so the metadata photo is merged in for display —
 *   the DP works even while the column does not exist yet.
 * - syncProfileFromMetadata: persist the metadata values onto the
 *   row, once per distinct (user, name, avatar) per app session.
 *
 * SYNC RULE (deliberate): when the metadata carries a name or photo,
 * it is authoritative for the profile's display_name / avatar_url
 * and is written whenever the row differs. That is the right call
 * for Google users — the whole point is that their Google name and
 * DP appear — and it is a no-op for email users, whose metadata
 * display_name is exactly what they typed at sign-up and who have
 * no avatar in metadata. The write only ever touches those two
 * columns on the caller's OWN row (profiles_update_own RLS, and the
 * profiles_guard_role trigger still blocks role changes); `role`
 * is never sent.
 */
export interface MetadataProfile {
  displayName: string | null;
  avatarUrl: string | null;
}

function cleanString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export function extractMetadataProfile(user: User): MetadataProfile {
  const meta = user.user_metadata ?? {};
  return {
    displayName:
      cleanString(meta.full_name) ??
      cleanString(meta.name) ??
      cleanString(meta.display_name),
    avatarUrl: cleanString(meta.avatar_url) ?? cleanString(meta.picture),
  };
}

/**
 * The profile to expose to the UI: the row wins for everything it
 * actually has; the metadata photo (and, if the row has no name, the
 * metadata name) fills the gaps. Pre-0004 the row simply has no
 * avatar_url key, so Google users still get their DP from metadata.
 */
export function mergeProfileWithMetadata(
  profile: Profile | null,
  meta: MetadataProfile,
): Profile | null {
  if (!profile) return profile;
  const avatar = profile.avatar_url ?? meta.avatarUrl;
  const name = profile.display_name ?? meta.displayName;
  if (avatar === (profile.avatar_url ?? null) && name === profile.display_name) {
    return profile;
  }
  return { ...profile, avatar_url: avatar, display_name: name };
}

/** Distinct syncs already attempted this app session (user|name|avatar). */
const attemptedSyncs = new Set<string>();

/**
 * Persist metadata name/photo onto the profiles row when they
 * differ. Returns the row to expose afterwards (the updated row, or
 * the metadata-merged input row). Never throws: a failed sync —
 * most importantly the missing avatar_url column before migration
 * 0004 is applied — must not break sign-in. In that case the write
 * is retried with display_name only, and the photo still reaches
 * the UI through mergeProfileWithMetadata.
 */
export async function syncProfileFromMetadata(
  user: User,
  profile: Profile | null,
): Promise<Profile | null> {
  const meta = extractMetadataProfile(user);
  const merged = mergeProfileWithMetadata(profile, meta);
  if (!supabase || !profile) return merged;
  if (!meta.displayName && !meta.avatarUrl) return merged; // nothing to sync (plain email user)

  const patch: { display_name?: string; avatar_url?: string } = {};
  if (meta.displayName && meta.displayName !== profile.display_name) {
    patch.display_name = meta.displayName;
  }
  if (meta.avatarUrl && meta.avatarUrl !== (profile.avatar_url ?? null)) {
    patch.avatar_url = meta.avatarUrl;
  }
  if (Object.keys(patch).length === 0) return merged;

  const signature = `${user.id}|${meta.displayName ?? ''}|${meta.avatarUrl ?? ''}`;
  if (attemptedSyncs.has(signature)) return merged;
  attemptedSyncs.add(signature);

  const client = supabase;
  const { error } = await client.from('profiles').update(patch).eq('id', user.id);
  if (!error) {
    return { ...profile, ...patch, avatar_url: patch.avatar_url ?? profile.avatar_url ?? null };
  }

  // Most likely cause: migration 0004 has not been applied yet, so
  // avatar_url does not exist. Log it, keep the photo for the UI via
  // the merged profile, and still persist the name on its own.
  console.warn(
    '[auth] profile sync failed (avatar migration 0004 may not be applied yet):',
    error.message,
  );
  if (patch.display_name) {
    const retry = await client
      .from('profiles')
      .update({ display_name: patch.display_name })
      .eq('id', user.id);
    if (!retry.error) {
      return {
        ...merged,
        display_name: patch.display_name,
      } as Profile;
    }
  }
  return merged;
}
