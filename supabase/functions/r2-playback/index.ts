// r2-playback — mint a SHORT-LIVED (<= 15 min) signed GET URL for a
// hosted video's HLS master playlist. Signed-in members only.
// Every check is re-done server-side (RLS is not relied on here):
//   * caller has a valid Supabase session;
//   * video exists, source='hosted', publish_state='published';
//   * its hosted_asset status is 'ready' with an hls_master_key;
//   * a content_authorizations row exists for the video (the same
//     evidence the DB publish gate required).
//
// SEGMENT SIGNING — READ THIS LIMITATION:
// Signing the master playlist alone does NOT make the whole stream
// private. The player fetches the playlist, then requests every
// segment/sub-playlist by RELATIVE URL from the same bucket path —
// those requests are unsigned, so this scheme only protects playback
// if the deployment ALSO puts an authorizing layer in front of the
// bucket (e.g. a Cloudflare Worker checking a cookie/token per
// object) or accepts that segment URLs are obscurity-grade once the
// playlist URL leaks. What this function DOES guarantee: no public
// or permanent URL is ever handed out, links expire in <= 15 min,
// and only members can obtain one. For convenience the function also
// accepts {video_id, key} to sign ONE additional object (e.g. a
// variant playlist) — strictly limited to keys under the video's own
// asset prefix, so it cannot be used to sign arbitrary bucket keys.
// If R2 secrets are not configured: 503 {error:'R2_NOT_CONFIGURED'}.

import { CORS_HEADERS, getCaller, json, serviceRest } from "../_shared/auth.ts";
import { getR2Config, presignUrl } from "../_shared/s3.ts";

const PLAYBACK_EXPIRES = 900; // 15 minutes, hard cap

interface VideoRow {
  id: string;
  source: string;
  publish_state: string;
}
interface AssetRow {
  id: string;
  r2_object_key: string;
  hls_master_key: string | null;
  status: string;
}

function assetPrefix(asset: AssetRow): string {
  const master = asset.hls_master_key ?? asset.r2_object_key;
  const idx = master.lastIndexOf("/");
  return idx >= 0 ? master.slice(0, idx + 1) : "";
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (req.method !== "POST") return json(405, { error: "METHOD_NOT_ALLOWED" });

  const cfg = getR2Config();
  if (!cfg) return json(503, { error: "R2_NOT_CONFIGURED" });

  const caller = await getCaller(req).catch(() => null);
  if (!caller) return json(401, { error: "UNAUTHENTICATED" });

  let body: { video_id?: string; key?: string };
  try {
    body = await req.json();
  } catch {
    return json(400, { error: "INVALID_JSON" });
  }
  const videoId = body.video_id;
  if (!videoId || typeof videoId !== "string") return json(400, { error: "VIDEO_ID_REQUIRED" });

  try {
    const videos = await serviceRest<VideoRow[]>(
      "GET",
      `/rest/v1/videos?id=eq.${videoId}&select=id,source,publish_state`,
    );
    const video = videos?.[0];
    if (!video || video.source !== "hosted" || video.publish_state !== "published") {
      return json(404, { error: "VIDEO_NOT_AVAILABLE" });
    }
    const assets = await serviceRest<AssetRow[]>(
      "GET",
      `/rest/v1/hosted_assets?video_id=eq.${videoId}&select=id,r2_object_key,hls_master_key,status`,
    );
    const asset = assets?.[0];
    if (!asset || asset.status !== "ready" || !asset.hls_master_key) {
      return json(409, { error: "ASSET_NOT_READY" });
    }
    const authz = await serviceRest<Array<{ id: string }>>(
      "GET",
      `/rest/v1/content_authorizations?video_id=eq.${videoId}&select=id&limit=1`,
    );
    if (!authz || authz.length === 0) {
      return json(403, { error: "NOT_AUTHORIZED_CONTENT" });
    }

    if (body.key !== undefined) {
      // Single-object signing, strictly inside this video's prefix.
      const prefix = assetPrefix(asset);
      if (
        typeof body.key !== "string" ||
        !prefix ||
        !body.key.startsWith(prefix) ||
        body.key.includes("..")
      ) {
        return json(400, { error: "KEY_OUTSIDE_ASSET_PREFIX" });
      }
      const url = await presignUrl(cfg, "GET", body.key, PLAYBACK_EXPIRES);
      return json(200, { url, expires_in: PLAYBACK_EXPIRES, kind: "object" });
    }

    const url = await presignUrl(cfg, "GET", asset.hls_master_key, PLAYBACK_EXPIRES);
    return json(200, { url, expires_in: PLAYBACK_EXPIRES, kind: "master" });
  } catch (e) {
    return json(502, { error: "PLAYBACK_ERROR", detail: e instanceof Error ? e.message : String(e) });
  }
});
