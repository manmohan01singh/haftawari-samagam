// The single rotation routine, shared by r2-admin (manual 'replace')
// and r2-rotate (scheduled). "Swap" is done at the VIDEO level with
// status flags, in this order (safety first):
//   1. Re-verify safety at action time: the old asset's video is not
//      referenced by any session with status upcoming/now_playing,
//      and a READY replacement asset exists.
//   2. DB swap: if the old video was published, the replacement's
//      video becomes published (the DB publish-gate trigger will
//      refuse if the replacement has no content authorization — the
//      swap then aborts and NOTHING is deleted) and the old video is
//      unpublished. If the old video was not published, no publish
//      state changes.
//   3. R2 deletion of the old asset's objects (original + HLS set).
//   4. The old hosted_assets row is removed and every step is
//      audit-logged. Deleting R2 objects AFTER the DB swap means a
//      failure mid-way leaves orphaned files, never a published
//      video pointing at deleted media.

import { serviceRest, writeAudit } from "./auth.ts";
import { deleteObjectWithPrefix, type R2Config } from "./s3.ts";

export interface RotationCandidate {
  asset_id: string;
  video_id: string;
  r2_object_key: string;
  hls_master_key: string | null;
  expires_at: string;
  replacement_asset_id: string;
  replacement_video_id: string;
}

interface VideoRow {
  id: string;
  publish_state: string;
  source: string;
}

interface AssetRow {
  id: string;
  video_id: string;
  r2_object_key: string;
  hls_master_key: string | null;
  status: string;
  replacement_of: string | null;
}

export async function isAssetInActiveSession(videoId: string): Promise<boolean> {
  const rows = await serviceRest<Array<{ id: string }>>(
    "GET",
    `/rest/v1/sessions?video_id=eq.${videoId}&status=in.(upcoming,now_playing)&select=id&limit=1`,
  );
  return (rows?.length ?? 0) > 0;
}

async function getVideo(videoId: string): Promise<VideoRow | null> {
  const rows = await serviceRest<VideoRow[]>(
    "GET",
    `/rest/v1/videos?id=eq.${videoId}&select=id,publish_state,source`,
  );
  return rows?.[0] ?? null;
}

async function getAsset(assetId: string): Promise<AssetRow | null> {
  const rows = await serviceRest<AssetRow[]>(
    "GET",
    `/rest/v1/hosted_assets?id=eq.${assetId}&select=id,video_id,r2_object_key,hls_master_key,status,replacement_of`,
  );
  return rows?.[0] ?? null;
}

async function setPublishState(videoId: string, state: string): Promise<void> {
  await serviceRest(
    "PATCH",
    `/rest/v1/videos?id=eq.${videoId}`,
    { publish_state: state, updated_at: new Date().toISOString() },
  );
}

/** Directory prefix of an HLS master key ('a/b/master.m3u8' -> 'a/b/'). */
function hlsPrefix(masterKey: string | null): string | undefined {
  if (!masterKey) return undefined;
  const idx = masterKey.lastIndexOf("/");
  return idx >= 0 ? masterKey.slice(0, idx + 1) : undefined;
}

export type RotateOutcome =
  | { ok: true; deletedObjects: number }
  | { ok: false; reason: string };

export async function rotateAsset(
  cfg: R2Config,
  candidate: RotationCandidate,
  actorId: string | null,
  via: string,
): Promise<RotateOutcome> {
  // 1. Safety re-checks (state may have changed since candidacy).
  if (await isAssetInActiveSession(candidate.video_id)) {
    return { ok: false, reason: "video is referenced by an upcoming/now_playing session" };
  }
  const replacement = await getAsset(candidate.replacement_asset_id);
  if (!replacement || replacement.status !== "ready") {
    return { ok: false, reason: "replacement asset is not ready" };
  }
  const oldVideo = await getVideo(candidate.video_id);
  const newVideo = await getVideo(candidate.replacement_video_id);
  if (!oldVideo || !newVideo) return { ok: false, reason: "video row missing" };

  // 2. DB swap via publish-state flags. If the replacement video has
  // no content authorization, the publish-gate trigger raises and the
  // whole swap aborts before anything is deleted.
  try {
    if (oldVideo.publish_state === "published") {
      await setPublishState(newVideo.id, "published");
      await setPublishState(oldVideo.id, "unpublished");
    }
  } catch (e) {
    return { ok: false, reason: `publish swap refused: ${e instanceof Error ? e.message : String(e)}` };
  }
  await writeAudit(actorId, "hosted.rotate_swap", "hosted_asset", candidate.asset_id, {
    via,
    old_video_id: candidate.video_id,
    replacement_asset_id: candidate.replacement_asset_id,
    replacement_video_id: candidate.replacement_video_id,
    old_video_was_published: oldVideo.publish_state === "published",
  });

  // 3. Delete the old objects from R2 (original + HLS set).
  let deletedObjects = 0;
  deletedObjects += await deleteObjectWithPrefix(cfg, candidate.r2_object_key);
  if (candidate.hls_master_key && candidate.hls_master_key !== candidate.r2_object_key) {
    deletedObjects += await deleteObjectWithPrefix(
      cfg,
      candidate.hls_master_key,
      hlsPrefix(candidate.hls_master_key),
    );
  }

  // 4. Remove the old asset row + audit.
  await serviceRest("DELETE", `/rest/v1/hosted_assets?id=eq.${candidate.asset_id}`);
  await writeAudit(actorId, "hosted.rotate_delete", "hosted_asset", candidate.asset_id, {
    via,
    video_id: candidate.video_id,
    r2_object_key: candidate.r2_object_key,
    hls_master_key: candidate.hls_master_key,
    deleted_objects: deletedObjects,
  });
  return { ok: true, deletedObjects };
}
