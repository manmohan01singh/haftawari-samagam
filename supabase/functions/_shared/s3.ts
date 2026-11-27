// AWS Signature Version 4 signing for Cloudflare R2 (S3-compatible),
// implemented by hand with WebCrypto — NO external dependencies and NO
// credentials in code. Credentials arrive only via Deno.env secrets:
//   R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET
// R2 uses region "auto" and service "s3".

export interface R2Config {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  endpoint: string; // https://<account>.r2.cloudflarestorage.com
}

/** Returns null when any R2 secret is absent (caller answers 503). */
export function getR2Config(): R2Config | null {
  const accountId = Deno.env.get("R2_ACCOUNT_ID");
  const accessKeyId = Deno.env.get("R2_ACCESS_KEY_ID");
  const secretAccessKey = Deno.env.get("R2_SECRET_ACCESS_KEY");
  const bucket = Deno.env.get("R2_BUCKET");
  if (!accountId || !accessKeyId || !secretAccessKey || !bucket) return null;
  return {
    accountId,
    accessKeyId,
    secretAccessKey,
    bucket,
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
  };
}

const enc = new TextEncoder();

async function sha256Hex(data: string | ArrayBuffer): Promise<string> {
  const buf = typeof data === "string" ? enc.encode(data) : new Uint8Array(data);
  const digest = await crypto.subtle.digest("SHA-256", buf as BufferSource);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function hmac(key: ArrayBuffer | Uint8Array, msg: string): Promise<ArrayBuffer> {
  const k = await crypto.subtle.importKey(
    "raw",
    key as BufferSource,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return crypto.subtle.sign("HMAC", k, enc.encode(msg));
}

function hexOf(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function signingKey(secret: string, dateStamp: string): Promise<ArrayBuffer> {
  const kDate = await hmac(enc.encode("AWS4" + secret), dateStamp);
  const kRegion = await hmac(kDate, "auto");
  const kService = await hmac(kRegion, "s3");
  return hmac(kService, "aws4_request");
}

function amzDates(now = new Date()): { amzDate: string; dateStamp: string } {
  const iso = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  return { amzDate: iso, dateStamp: iso.slice(0, 8) };
}

function encodeKey(key: string): string {
  // S3 path-style key encoding: keep '/' separators, encode each segment.
  return key.split("/").map(encodeURIComponent).join("/");
}

/**
 * Presign a URL (query-string auth) for GET or PUT.
 * Max expiry honoured by S3 SigV4 is 7 days; callers in this project
 * use <= 15 minutes for playback and <= 60 minutes for upload parts.
 */
export async function presignUrl(
  cfg: R2Config,
  method: "GET" | "PUT",
  key: string,
  expiresSeconds: number,
  extraQuery: Record<string, string> = {},
): Promise<string> {
  const { amzDate, dateStamp } = amzDates();
  const credentialScope = `${dateStamp}/auto/s3/aws4_request`;
  const host = new URL(cfg.endpoint).host;
  const canonicalUri = `/${cfg.bucket}/${encodeKey(key)}`;
  const query: Record<string, string> = {
    "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
    "X-Amz-Credential": `${cfg.accessKeyId}/${credentialScope}`,
    "X-Amz-Date": amzDate,
    "X-Amz-Expires": String(expiresSeconds),
    "X-Amz-SignedHeaders": "host",
    ...extraQuery,
  };
  const canonicalQuery = Object.keys(query)
    .sort()
    .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(query[k])}`)
    .join("&");
  const canonicalRequest = [
    method,
    canonicalUri,
    canonicalQuery,
    `host:${host}\n`,
    "host",
    "UNSIGNED-PAYLOAD",
  ].join("\n");
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    await sha256Hex(canonicalRequest),
  ].join("\n");
  const signature = hexOf(await hmac(await signingKey(cfg.secretAccessKey, dateStamp), stringToSign));
  return `${cfg.endpoint}${canonicalUri}?${canonicalQuery}&X-Amz-Signature=${signature}`;
}

/** Signed fetch against the R2 S3 API (header auth). Returns the raw Response. */
export async function s3Fetch(
  cfg: R2Config,
  method: string,
  key: string | null,
  query: Record<string, string> = {},
  body?: string,
): Promise<Response> {
  const { amzDate, dateStamp } = amzDates();
  const credentialScope = `${dateStamp}/auto/s3/aws4_request`;
  const host = new URL(cfg.endpoint).host;
  const canonicalUri = key ? `/${cfg.bucket}/${encodeKey(key)}` : `/${cfg.bucket}`;
  const canonicalQuery = Object.keys(query)
    .sort()
    .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(query[k])}`)
    .join("&");
  const payloadHash = await sha256Hex(body ?? "");
  const headers: Record<string, string> = {
    host,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amzDate,
  };
  const signedHeaders = Object.keys(headers).sort().join(";");
  const canonicalHeaders =
    Object.keys(headers).sort().map((k) => `${k}:${headers[k]}\n`).join("");
  const canonicalRequest = [
    method,
    canonicalUri,
    canonicalQuery,
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    await sha256Hex(canonicalRequest),
  ].join("\n");
  const signature = hexOf(await hmac(await signingKey(cfg.secretAccessKey, dateStamp), stringToSign));
  const url = `${cfg.endpoint}${canonicalUri}${canonicalQuery ? `?${canonicalQuery}` : ""}`;
  return fetch(url, {
    method,
    headers: {
      Authorization:
        `AWS4-HMAC-SHA256 Credential=${cfg.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
      "x-amz-content-sha256": payloadHash,
      "x-amz-date": amzDate,
      ...(body ? { "Content-Type": "application/xml" } : {}),
    },
    body,
  });
}

function xmlTag(xml: string, tag: string): string | null {
  const m = new RegExp(`<${tag}>([^<]+)</${tag}>`).exec(xml);
  return m ? m[1] : null;
}

// ── Multipart upload ─────────────────────────────────────────────────

export async function createMultipart(
  cfg: R2Config,
  key: string,
  contentType: string,
): Promise<string> {
  // Content-Type for multipart creation travels as a query-free header
  // in real S3; R2 accepts the uploads POST without it and records the
  // type at Complete time from the object PUT defaults. We pass the
  // intended type through presign-put for single-shot uploads instead.
  void contentType;
  const res = await s3Fetch(cfg, "POST", key, { uploads: "" });
  const text = await res.text();
  if (!res.ok) throw new Error(`R2 create-multipart failed (${res.status}): ${text.slice(0, 200)}`);
  const uploadId = xmlTag(text, "UploadId");
  if (!uploadId) throw new Error("R2 create-multipart returned no UploadId");
  return uploadId;
}

export async function completeMultipart(
  cfg: R2Config,
  key: string,
  uploadId: string,
  parts: { partNumber: number; etag: string }[],
): Promise<void> {
  const body =
    `<CompleteMultipartUpload>` +
    parts
      .slice()
      .sort((a, b) => a.partNumber - b.partNumber)
      .map((p) => `<Part><PartNumber>${p.partNumber}</PartNumber><ETag>${p.etag}</ETag></Part>`)
      .join("") +
    `</CompleteMultipartUpload>`;
  const res = await s3Fetch(cfg, "POST", key, { uploadId }, body);
  const text = await res.text();
  if (!res.ok) throw new Error(`R2 complete-multipart failed (${res.status}): ${text.slice(0, 200)}`);
  // S3 can return HTTP 200 with an embedded <Error> body.
  if (text.includes("<Error>")) throw new Error(`R2 complete-multipart error: ${text.slice(0, 200)}`);
}

export async function abortMultipart(cfg: R2Config, key: string, uploadId: string): Promise<void> {
  const res = await s3Fetch(cfg, "DELETE", key, { uploadId });
  if (!res.ok && res.status !== 404) {
    throw new Error(`R2 abort-multipart failed (${res.status})`);
  }
}

// ── Object operations ────────────────────────────────────────────────

export async function deleteObject(cfg: R2Config, key: string): Promise<void> {
  const res = await s3Fetch(cfg, "DELETE", key);
  if (!res.ok && res.status !== 404) {
    throw new Error(`R2 delete failed for ${key} (${res.status})`);
  }
}

export interface HeadObjectResult {
  sizeBytes: number;
  contentType: string | null;
}

/**
 * HEAD an object — server-measured metadata, no body. Returns null
 * when the object does not exist (404). This is the ONLY trustworthy
 * source of an uploaded object's size/type: anything the client
 * claims about its own upload is unverified until measured here.
 */
export async function headObject(
  cfg: R2Config,
  key: string,
): Promise<HeadObjectResult | null> {
  const res = await s3Fetch(cfg, "HEAD", key);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`R2 head failed for ${key} (${res.status})`);
  const len = res.headers.get("content-length");
  const sizeBytes = len !== null ? Number(len) : NaN;
  if (!Number.isFinite(sizeBytes) || sizeBytes < 0) {
    throw new Error(`R2 head for ${key} returned no usable Content-Length`);
  }
  return { sizeBytes, contentType: res.headers.get("content-type") };
}

/** List up to `maxKeys` object keys under a prefix (single page). */
export async function listKeys(cfg: R2Config, prefix: string, maxKeys = 200): Promise<string[]> {
  const res = await s3Fetch(cfg, "GET", null, {
    "list-type": "2",
    prefix,
    "max-keys": String(maxKeys),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`R2 list failed (${res.status}): ${text.slice(0, 200)}`);
  const keys: string[] = [];
  for (const m of text.matchAll(/<Key>([^<]+)<\/Key>/g)) keys.push(m[1]);
  return keys;
}

/** Delete an object and (for HLS) every object under its directory prefix. */
export async function deleteObjectWithPrefix(
  cfg: R2Config,
  key: string,
  prefix?: string,
): Promise<number> {
  let deleted = 0;
  if (prefix) {
    const keys = await listKeys(cfg, prefix).catch(() => [] as string[]);
    for (const k of keys) {
      await deleteObject(cfg, k);
      deleted++;
    }
  }
  await deleteObject(cfg, key);
  return deleted + 1;
}
