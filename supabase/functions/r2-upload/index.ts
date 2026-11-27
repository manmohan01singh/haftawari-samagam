// r2-upload — admin-only upload signing for Cloudflare R2.
// The browser uploads file bytes DIRECTLY to R2 with the signed URLs
// minted here; no file ever passes through this function, and no R2
// credential ever leaves the server. Actions:
//   presign-put      {key, content_type, size_bytes?} -> {url, expires_in}
//   create-multipart {key, content_type, size_bytes?} -> {upload_id}
//   sign-part        {key, upload_id, part_number}   -> {url, expires_in}
//   complete         {key, upload_id, parts[]}       -> {ok:true}
//   abort            {key, upload_id}                -> {ok:true}
//   verify-object    {key}  -> HEAD the object in R2 and report its
//                     SERVER-measured size/type (404 when absent),
//                     then check the first 32 bytes' magic signature
//                     against the type ('ftyp' for MP4/MOV, EBML for
//                     WebM; mismatch -> 400 CONTENT_SIGNATURE_MISMATCH,
//                     unfetchable bytes -> 502, never a silent pass).
//                     The admin UI must run this before an asset may
//                     be marked 'ready' — client-claimed size/type
//                     are never trusted.
// Audit: 'complete' and a successful 'verify-object' append
// audit_logs entries (hosted.upload_completed /
// hosted.object_verified, actor = the calling admin). Audit writes
// are best-effort — a failure never changes the response.
// All object keys must live under the 'hosted/' prefix.
// Upload validation, enforced HERE (server-side), never only in UI:
//   * MIME allowlist: video/mp4, video/webm, video/quicktime.
//     Anything else — including a missing content_type — is refused
//     at signing time (400 UNSUPPORTED_MEDIA_TYPE) and again at
//     verify time against the object's stored type.
//   * Size cap: MAX_OBJECT_BYTES (8 GiB). A declared size_bytes over
//     the cap is refused at signing time (413 FILE_TOO_LARGE); the
//     HARD check is verify-object, which measures the real object.
// If R2 secrets are not configured: 503 {error:'R2_NOT_CONFIGURED'}.

import { CORS_HEADERS, getCaller, json, writeAudit } from "../_shared/auth.ts";
import {
  abortMultipart,
  completeMultipart,
  createMultipart,
  getR2Config,
  headObject,
  presignUrl,
} from "../_shared/s3.ts";

const PUT_EXPIRES = 3600; // 60 min for a single-shot PUT
const PART_EXPIRES = 3600; // 60 min per part URL

/** Hard cap for one hosted original: 8 GiB. */
export const MAX_OBJECT_BYTES = 8 * 1024 * 1024 * 1024;

/** The only media types a hosted original may be. */
const ALLOWED_CONTENT_TYPES = new Set(["video/mp4", "video/webm", "video/quicktime"]);

function validKey(key: unknown): key is string {
  return typeof key === "string" && key.startsWith("hosted/") && !key.includes("..") && key.length <= 512;
}

/** Normalize a declared content type ('Video/MP4; codecs=…' -> 'video/mp4'); '' when absent. */
function declaredContentType(body: Record<string, unknown>): string {
  const raw = body.content_type;
  if (typeof raw !== "string") return "";
  return raw.split(";")[0].trim().toLowerCase();
}

function contentTypeAllowed(body: Record<string, unknown>): boolean {
  return ALLOWED_CONTENT_TYPES.has(declaredContentType(body));
}

/** Advisory signing-time size check; the hard check is verify-object's HEAD. */
function declaredSizeTooLarge(body: Record<string, unknown>): boolean {
  const size = body.size_bytes;
  return typeof size === "number" && Number.isFinite(size) && size > MAX_OBJECT_BYTES;
}

// ── Content signature (magic bytes) ─────────────────────────────────
// HEAD metadata can claim any type; the first bytes of the file
// cannot lie as easily. MP4/MOV carry an ISO-BMFF 'ftyp' box at
// bytes 4–8; WebM starts with the EBML header 1A 45 DF A3.
function hasFtypBox(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 8 &&
    String.fromCharCode(bytes[4], bytes[5], bytes[6], bytes[7]) === "ftyp"
  );
}

function hasEbmlHeader(bytes: Uint8Array): boolean {
  return bytes.length >= 4 && bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3;
}

/**
 * Does the object's leading bytes match its (HEAD-reported) type?
 * When R2 reports no type, any known video signature is accepted —
 * an unrecognized header is still a failure, never a silent pass.
 */
function signatureMatches(bytes: Uint8Array, actualType: string | null): boolean {
  if (actualType === "video/webm") return hasEbmlHeader(bytes);
  if (actualType === "video/mp4" || actualType === "video/quicktime") return hasFtypBox(bytes);
  return hasFtypBox(bytes) || hasEbmlHeader(bytes);
}

/** Audit is evidence, not a gate: a failed write must never break the response. */
async function auditQuietly(
  actorId: string,
  action: string,
  details: Record<string, unknown>,
): Promise<void> {
  try {
    await writeAudit(actorId, action, "r2_object", null, details);
  } catch {
    // deliberately swallowed — see comment above
  }
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
        if (!contentTypeAllowed(body)) return json(400, { error: "UNSUPPORTED_MEDIA_TYPE" });
        if (declaredSizeTooLarge(body)) return json(413, { error: "FILE_TOO_LARGE" });
        const url = await presignUrl(cfg, "PUT", key, PUT_EXPIRES);
        return json(200, { url, expires_in: PUT_EXPIRES });
      }
      case "create-multipart": {
        if (!contentTypeAllowed(body)) return json(400, { error: "UNSUPPORTED_MEDIA_TYPE" });
        if (declaredSizeTooLarge(body)) return json(413, { error: "FILE_TOO_LARGE" });
        const uploadId = await createMultipart(cfg, key, declaredContentType(body));
        return json(200, { upload_id: uploadId });
      }
      case "verify-object": {
        // Hard, server-measured check: the object must actually exist
        // in R2, be within the size cap, and carry an allowed type.
        const head = await headObject(cfg, key);
        if (!head) return json(404, { error: "OBJECT_NOT_FOUND" });
        if (head.sizeBytes > MAX_OBJECT_BYTES) return json(413, { error: "FILE_TOO_LARGE" });
        const actualType = head.contentType
          ? head.contentType.split(";")[0].trim().toLowerCase()
          : null;
        if (actualType && !ALLOWED_CONTENT_TYPES.has(actualType)) {
          return json(400, { error: "UNSUPPORTED_MEDIA_TYPE" });
        }
        // Content signature: fetch the first 32 bytes (Range GET on a
        // short-lived presigned URL) and check the magic bytes against
        // the type. A failed fetch FAILS verification — never a pass.
        let headBytes: Uint8Array;
        try {
          const getUrl = await presignUrl(cfg, "GET", key, 60);
          const rangeRes = await fetch(getUrl, { headers: { Range: "bytes=0-31" } });
          if (!rangeRes.ok) throw new Error(`range GET returned HTTP ${rangeRes.status}`);
          headBytes = new Uint8Array(await rangeRes.arrayBuffer());
        } catch (e) {
          return json(502, {
            error: "CONTENT_SIGNATURE_CHECK_FAILED",
            detail: e instanceof Error ? e.message : String(e),
          });
        }
        if (!signatureMatches(headBytes, actualType)) {
          return json(400, { error: "CONTENT_SIGNATURE_MISMATCH" });
        }
        await auditQuietly(caller.userId, "hosted.object_verified", {
          action: "verify-object",
          key,
          size_bytes: head.sizeBytes,
          content_type: actualType,
        });
        return json(200, {
          exists: true,
          size_bytes: head.sizeBytes,
          content_type: actualType,
        });
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
        await auditQuietly(caller.userId, "hosted.upload_completed", {
          action: "complete",
          key,
          upload_id: uploadId,
          parts: parts.length,
        });
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
