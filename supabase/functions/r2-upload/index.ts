// r2-upload — admin-only upload signing for Cloudflare R2.
// The browser uploads file bytes DIRECTLY to R2 with the signed URLs
// minted here; no file ever passes through this function, and no R2
// credential ever leaves the server. Actions:
//   presign-put      {key, content_type?}            -> {url, expires_in}
//   create-multipart {key}                           -> {upload_id}
//   sign-part        {key, upload_id, part_number}   -> {url, expires_in}
//   complete         {key, upload_id, parts[]}       -> {ok:true}
//   abort            {key, upload_id}                -> {ok:true}
// All object keys must live under the 'hosted/' prefix.
// If R2 secrets are not configured: 503 {error:'R2_NOT_CONFIGURED'}.

import { CORS_HEADERS, getCaller, json } from "../_shared/auth.ts";
import {
  abortMultipart,
  completeMultipart,
  createMultipart,
  getR2Config,
  presignUrl,
} from "../_shared/s3.ts";

const PUT_EXPIRES = 3600; // 60 min for a single-shot PUT
const PART_EXPIRES = 3600; // 60 min per part URL

function validKey(key: unknown): key is string {
  return typeof key === "string" && key.startsWith("hosted/") && !key.includes("..") && key.length <= 512;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (req.method !== "POST") return json(405, { error: "METHOD_NOT_ALLOWED" });

  const cfg = getR2Config();
  if (!cfg) return json(503, { error: "R2_NOT_CONFIGURED" });

  const caller = await getCaller(req).catch(() => null);
  if (!caller) return json(401, { error: "UNAUTHENTICATED" });
  if (caller.role !== "admin") return json(403, { error: "ADMIN_ONLY" });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json(400, { error: "INVALID_JSON" });
  }
  const action = body.action;
  const key = body.key;
  if (!validKey(key)) return json(400, { error: "INVALID_KEY", detail: "key must start with hosted/" });

  try {
    switch (action) {
      case "presign-put": {
        const url = await presignUrl(cfg, "PUT", key, PUT_EXPIRES);
        return json(200, { url, expires_in: PUT_EXPIRES });
      }
      case "create-multipart": {
        const uploadId = await createMultipart(cfg, key, String(body.content_type ?? ""));
        return json(200, { upload_id: uploadId });
      }
      case "sign-part": {
        const uploadId = String(body.upload_id ?? "");
        const partNumber = Number(body.part_number ?? 0);
        if (!uploadId || !Number.isInteger(partNumber) || partNumber < 1 || partNumber > 10000) {
          return json(400, { error: "INVALID_PART" });
        }
        const url = await presignUrl(cfg, "PUT", key, PART_EXPIRES, {
          partNumber: String(partNumber),
          uploadId,
        });
        return json(200, { url, expires_in: PART_EXPIRES });
      }
      case "complete": {
        const uploadId = String(body.upload_id ?? "");
        const parts = body.parts as { partNumber: number; etag: string }[] | undefined;
        if (!uploadId || !Array.isArray(parts) || parts.length === 0) {
          return json(400, { error: "INVALID_PARTS" });
        }
        await completeMultipart(cfg, key, uploadId, parts);
        return json(200, { ok: true });
      }
      case "abort": {
        const uploadId = String(body.upload_id ?? "");
        if (!uploadId) return json(400, { error: "INVALID_UPLOAD_ID" });
        await abortMultipart(cfg, key, uploadId);
        return json(200, { ok: true });
      }
      default:
        return json(400, { error: "UNKNOWN_ACTION" });
    }
  } catch (e) {
    return json(502, { error: "R2_ERROR", detail: e instanceof Error ? e.message : String(e) });
  }
});
