import { requireSupabase } from '../../lib/supabase';
import { HostedNotConfiguredError } from './hostedService';
import type { UploadProgress } from './hostedUpload';

export type { UploadProgress };

/**
 * Web upload of an ORIGINAL file (from the rights holder — never a
 * YouTube download) straight from the browser to Cloudflare R2.
 * Signing is done by the r2-upload Edge Function (admin-only); the
 * file bytes go browser -> R2 directly and never touch Supabase.
 *
 * Small files (<= 64 MB): one presigned PUT with XHR progress.
 * Larger files: multipart — 16 MB parts, each presigned, uploaded
 * with XHR (for the ETag header + progress), then completed.
 *
 * Deployment note: the R2 bucket needs a CORS policy allowing PUT
 * from the app origin and exposing the ETag header, or the browser
 * will block these requests (see docs/HOSTED_VIDEO.md).
 */

const SINGLE_PUT_MAX = 64 * 1024 * 1024;
const PART_SIZE = 16 * 1024 * 1024;

interface SignResponse {
  url?: string;
  upload_id?: string;
  ok?: boolean;
  exists?: boolean;
  size_bytes?: number;
  content_type?: string | null;
  error?: string;
  detail?: string;
}

async function callR2Upload(body: Record<string, unknown>): Promise<SignResponse> {
  const supabase = requireSupabase();
  const { data, error } = await supabase.functions.invoke<SignResponse>('r2-upload', { body });
  if (error) {
    let code: string | undefined;
    try {
      const ctx = (error as { context?: Response }).context;
      if (ctx && typeof ctx.clone === 'function') {
        const parsed = (await ctx.clone().json()) as SignResponse;
        code = parsed.error;
      }
    } catch {
      // fall through
    }
    if (code === 'R2_NOT_CONFIGURED') throw new HostedNotConfiguredError();
    if (code) throw new Error(code);
    throw error;
  }
  if (data?.error === 'R2_NOT_CONFIGURED') throw new HostedNotConfiguredError();
  if (data?.error) throw new Error(data.detail ? `${data.error}: ${data.detail}` : data.error);
  return data ?? {};
}

function xhrPut(
  url: string,
  body: Blob,
  onProgress?: (loaded: number) => void,
): Promise<string | null> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress?.(e.loaded);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(xhr.getResponseHeader('ETag'));
      } else {
        reject(new Error(`Upload failed with HTTP ${xhr.status}`));
      }
    };
    xhr.onerror = () => reject(new Error('Upload failed (network or bucket CORS policy).'));
    xhr.send(body);
  });
}

export async function uploadOriginalToR2(
  file: File,
  key: string,
  onProgress?: (p: UploadProgress) => void,
): Promise<void> {
  const total = file.size;
  if (total <= SINGLE_PUT_MAX) {
    // size_bytes is advisory at signing time (the signer refuses a
    // declared size over the 8 GiB cap); the hard, server-measured
    // check happens later via the signer's verify-object action.
    const { url } = await callR2Upload({
      action: 'presign-put',
      key,
      content_type: file.type,
      size_bytes: file.size,
    });
    if (!url) throw new Error('The upload signer returned no URL.');
    await xhrPut(url, file, (loaded) => onProgress?.({ loadedBytes: loaded, totalBytes: total }));
    onProgress?.({ loadedBytes: total, totalBytes: total });
    return;
  }

  const { upload_id: uploadId } = await callR2Upload({
    action: 'create-multipart',
    key,
    content_type: file.type,
    size_bytes: file.size,
  });
  if (!uploadId) throw new Error('The upload signer returned no upload id.');
  try {
    const parts: { partNumber: number; etag: string }[] = [];
    let uploaded = 0;
    const partCount = Math.ceil(total / PART_SIZE);
    for (let i = 0; i < partCount; i++) {
      const partNumber = i + 1;
      const slice = file.slice(i * PART_SIZE, Math.min(total, (i + 1) * PART_SIZE));
      // Per-part retry (audit P1, 28 Nov 2026): one transient
      // failure used to abort the WHOLE multipart upload, throwing
      // away every completed part — a GB-size samagam upload from a
      // phone could effectively never finish on a shaky connection.
      // Each part now gets 3 attempts (fresh signed URL each time)
      // before the upload as a whole gives up.
      let etag: string | null = null;
      let lastPartError: unknown = null;
      for (let attempt = 0; attempt < 3 && !etag; attempt++) {
        if (attempt > 0) {
          await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
        }
        try {
          const { url } = await callR2Upload({
            action: 'sign-part',
            key,
            upload_id: uploadId,
            part_number: partNumber,
          });
          if (!url) throw new Error('The upload signer returned no part URL.');
          const base = uploaded;
          etag = await xhrPut(url, slice, (loaded) =>
            onProgress?.({ loadedBytes: base + loaded, totalBytes: total }),
          );
          if (!etag) throw new Error(`Part ${partNumber} returned no ETag (bucket CORS must expose ETag).`);
        } catch (e) {
          lastPartError = e;
          etag = null;
        }
      }
      if (!etag) throw lastPartError instanceof Error ? lastPartError : new Error(`Part ${partNumber} failed after 3 attempts.`);
      parts.push({ partNumber, etag });
      uploaded += slice.size;
    }
    await callR2Upload({ action: 'complete', key, upload_id: uploadId, parts });
    onProgress?.({ loadedBytes: total, totalBytes: total });
  } catch (e) {
    await callR2Upload({ action: 'abort', key, upload_id: uploadId }).catch(() => undefined);
    throw e;
  }
}
