// r2-admin — admin-only destructive/rotation actions on hosted assets.
//   {action:'delete',  asset_id, confirm_only_copy?:boolean}
//   {action:'replace', asset_id}
// Safety rules (all enforced server-side, all actions audit-logged):
//   * refuses to touch an asset whose video is referenced by a
//     session with status upcoming/now_playing;
//   * 'delete' refuses to remove the ONLY ready copy (asset is ready
//     and no ready replacement exists) unless confirm_only_copy=true;
//   * 'replace' requires a ready replacement and then performs the
//     shared rotation routine (publish-state swap + R2 delete).
// If R2 secrets are not configured: 503 {error:'R2_NOT_CONFIGURED'}.

import { CORS_HEADERS, getCaller, json, serviceRest, writeAudit } from "../_shared/auth.ts";
import { getR2Config, deleteObjectWithPrefix } from "../_shared/s3.ts";
import { isAssetInActiveSession, rotateAsset } from "../_shared/rotate.ts";

interface AssetRow {
  id: string;
  video_id: string;
  r2_object_key: string;
  hls_master_key: string | null;
  status: string;
  expires_at: string | null;
  replacement_of: string | null;
}

async function getAsset(assetId: string): Promise<AssetRow | null> {
  const rows = await serviceRest<AssetRow[]>(
    "GET",
    `/rest/v1/hosted_assets?id=eq.${assetId}&select=id,video_id,r2_object_key,hls_master_key,status,expires_at,replacement_of`,
  );
  return rows?.[0] ?? null;
}

async function readyReplacement(assetId: string): Promise<AssetRow | null> {
  const rows = await serviceRest<AssetRow[]>(
    "GET",
    `/rest/v1/hosted_assets?replacement_of=eq.${assetId}&status=eq.ready&select=id,video_id,r2_object_key,hls_master_key,status,expires_at,replacement_of&limit=1`,
  );
  return rows?.[0] ?? null;
}

function hlsPrefix(masterKey: string | null): string | undefined {
  if (!masterKey) return undefined;
  const idx = masterKey.lastIndexOf("/");
  return idx >= 0 ? masterKey.slice(0, idx + 1) : undefined;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (req.method !== "POST") return json(405, { error: "METHOD_NOT_ALLOWED" });

  const cfg = getR2Config();
  if (!cfg) return json(503, { error: "R2_NOT_CONFIGURED" });

  const caller = await getCaller(req).catch(() => null);
  if (!caller) return json(401, { error: "UNAUTHENTICATED" });
  if (caller.role !== "admin") return json(403, { error: "ADMIN_ONLY" });

  let body: { action?: string; asset_id?: string; confirm_only_copy?: boolean };
  try {
    body = await req.json();
  } catch {
    return json(400, { error: "INVALID_JSON" });
  }
  if (!body.asset_id) return json(400, { error: "ASSET_ID_REQUIRED" });

  try {
    const asset = await getAsset(body.asset_id);
    if (!asset) return json(404, { error: "ASSET_NOT_FOUND" });

    if (await isAssetInActiveSession(asset.video_id)) {
      return json(409, {
        error: "ASSET_IN_ACTIVE_SESSION",
        detail: "This video is scheduled in an upcoming or now-playing session. Cancel or finish that session first.",
      });
    }

    if (body.action === "replace") {
      const replacement = await readyReplacement(asset.id);
      if (!replacement) {
        return json(409, { error: "NO_READY_REPLACEMENT" });
      }
      const outcome = await rotateAsset(
        cfg,
        {
          asset_id: asset.id,
          video_id: asset.video_id,
          r2_object_key: asset.r2_object_key,
          hls_master_key: asset.hls_master_key,
          expires_at: asset.expires_at ?? new Date().toISOString(),
          replacement_asset_id: replacement.id,
          replacement_video_id: replacement.video_id,
        },
        caller.userId,
        "r2-admin.replace",
      );
      if (!outcome.ok) return json(409, { error: "ROTATE_REFUSED", detail: outcome.reason });
      return json(200, { ok: true, deleted_objects: outcome.deletedObjects });
    }

    if (body.action === "delete") {
      const replacement = await readyReplacement(asset.id);
      const isOnlyReadyCopy = asset.status === "ready" && !replacement;
      if (isOnlyReadyCopy && body.confirm_only_copy !== true) {
        return json(409, {
          error: "ONLY_READY_COPY",
          detail: "This is the only ready copy and no ready replacement exists. Resend with confirm_only_copy=true to delete it anyway.",
        });
      }
      await writeAudit(caller.userId, "hosted.asset_delete", "hosted_asset", asset.id, {
        via: "r2-admin.delete",
        video_id: asset.video_id,
        r2_object_key: asset.r2_object_key,
        hls_master_key: asset.hls_master_key,
        was_only_ready_copy: isOnlyReadyCopy,
        confirmed_only_copy: body.confirm_only_copy === true,
      });
      let deleted = 0;
      deleted += await deleteObjectWithPrefix(cfg, asset.r2_object_key);
      if (asset.hls_master_key && asset.hls_master_key !== asset.r2_object_key) {
        deleted += await deleteObjectWithPrefix(cfg, asset.hls_master_key, hlsPrefix(asset.hls_master_key));
      }
      await serviceRest("DELETE", `/rest/v1/hosted_assets?id=eq.${asset.id}`);
      return json(200, { ok: true, deleted_objects: deleted });
    }

    return json(400, { error: "UNKNOWN_ACTION" });
  } catch (e) {
    return json(502, { error: "ADMIN_ACTION_ERROR", detail: e instanceof Error ? e.message : String(e) });
  }
});
