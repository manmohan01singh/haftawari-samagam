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
 * SYNC RULE (deliberate, changed for Edit Profile): metadata is a
 * FIRST-SEED only. It may fill display_name / avatar_url when the
 * stored value is empty/null — that is how a Google user's name and
 * DP appear on their first sign-in — but it must NEVER overwrite a
 * non-empty stored value. The profiles row is the user's own data:
 * once they edit their name in Edit Profile, that edit wins over
 * Google metadata on every later sign-in, forever. The same holds
 * for avatar_url: seeded from Google when empty, never replaced
 * afterwards by sync. The write only ever touches those two columns
 * on the caller's OWN row (profiles_update_own RLS, and the
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
 * Persist metadata name/photo onto the profiles row — FIRST-SEED
 * ONLY: a field is written only while the stored value is empty.
 * A non-empty stored display_name (e.g. the user's own Edit Profile
 * change) is never overwritten by metadata, on any sign-in. Returns
 * the row to expose afterwards (the updated row, or the
 * metadata-merged input row). Never throws: a failed sync — most
 * importantly the missing avatar_url column before migration
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
  // First-seed only — see the SYNC RULE above. `cleanString` has
  // already normalised metadata, so a stored value that is null or
  // blank is "empty" and may be seeded; anything else is the user's
  // own data and stays.
  const storedName = profile.display_name?.trim() ? profile.display_name : null;
  const storedAvatar = profile.avatar_url?.trim() ? profile.avatar_url : null;
  if (meta.displayName && !storedName) {
    patch.display_name = meta.displayName;
  }
  if (meta.avatarUrl && !storedAvatar) {
    patch.avatar_url = meta.avatarUrl;
  }
  if (Object.keys(patch).length === 0) return merged;

  const signature = `${user.id}|${meta.displayName ?? ''}|${meta.avatarUrl ?? ''}`;
  if (attemptedSyncs.has(signature)) return merged;
  // The signature is recorded only AFTER a successful persist
  // (audit P2, 28 Nov 2026): marking it before the update meant one
  // transient failure silently lost the Google name/DP seed for the
  // whole app session.
  const client = supabase;
  const { error } = await client.from('profiles').update(patch).eq('id', user.id);
  if (!error) {
    attemptedSyncs.add(signature);
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
      attemptedSyncs.add(signature);
      return {
        ...merged,
        display_name: patch.display_name,
      } as Profile;
    }
  }
  return merged;
}
