import * as FileSystem from 'expo-file-system/legacy';
import { requireSupabase } from '../../lib/supabase';
import { HostedNotConfiguredError } from './hostedService';

/**
 * Native upload of an ORIGINAL file (from the rights holder — never a
 * YouTube download) straight from the admin's phone to Cloudflare R2.
 * Same signer protocol as the web implementation (hostedUpload.web.ts,
 * which Metro resolves on web builds): the r2-upload Edge Function
 * (admin-only) presigns; the file bytes go phone -> R2 directly and
 * never touch Supabase.
 *
 * Small files (<= 64 MB): one presigned PUT via an upload task (real
 * progress). Larger files: multipart — 16 MB parts; each part is
 * copied to a temp cache file (base64 range read, so memory stays
 * flat) and PUT with an upload task; ETags come from the response
 * headers (no CORS on native, so headers are readable).
 *
 * The `file` argument is the document-picker asset shape:
 * { uri, name, mimeType, size }.
 */

export interface UploadProgress {
  loadedBytes: number;
  totalBytes: number;
}

export interface NativeUploadFile {
  uri: string;
  name: string;
  mimeType?: string | null;
  size: number;
}

const SINGLE_PUT_MAX = 64 * 1024 * 1024;
const PART_SIZE = 16 * 1024 * 1024;

interface SignResponse {
  url?: string;
  upload_id?: string;
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

async function putFile(
  url: string,
  fileUri: string,
  contentType: string,
  onLoaded?: (loaded: number) => void,
): Promise<string | null> {
  const task = FileSystem.createUploadTask(
    url,
    fileUri,
    {
      httpMethod: 'PUT',
      uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
      headers: { 'Content-Type': contentType },
    },
    (p) => onLoaded?.(p.totalBytesSent),
  );
  const result = await task.uploadAsync();
  if (!result) throw new Error('Upload failed (no response).');
  if (result.status < 200 || result.status >= 300) {
    throw new Error(`Upload failed with HTTP ${result.status}`);
  }
  const etag = result.headers?.ETag ?? result.headers?.etag ?? null;
  return etag;
}

export async function uploadOriginalToR2(
  file: unknown,
  key: string,
  onProgress?: (p: UploadProgress) => void,
): Promise<void> {
  const picked = file as NativeUploadFile;
  if (!picked || typeof picked.uri !== 'string' || typeof picked.size !== 'number') {
    throw new Error('No file was picked.');
  }
  const total = picked.size;
  const contentType = picked.mimeType || 'video/mp4';

  if (total <= SINGLE_PUT_MAX) {
    const { url } = await callR2Upload({
      action: 'presign-put',
      key,
      content_type: contentType,
      size_bytes: total,
    });
    if (!url) throw new Error('The upload signer returned no URL.');
    await putFile(url, picked.uri, contentType, (loaded) =>
      onProgress?.({ loadedBytes: loaded, totalBytes: total }),
    );
    onProgress?.({ loadedBytes: total, totalBytes: total });
    return;
  }

  const { upload_id: uploadId } = await callR2Upload({
    action: 'create-multipart',
    key,
    content_type: contentType,
    size_bytes: total,
  });
  if (!uploadId) throw new Error('The upload signer returned no upload id.');
  try {
    const parts: { partNumber: number; etag: string }[] = [];
    let uploaded = 0;
    const partCount = Math.ceil(total / PART_SIZE);
    for (let i = 0; i < partCount; i++) {
      const partNumber = i + 1;
      const length = Math.min(PART_SIZE, total - uploaded);
      // Range-read this part as base64 into a temp file, then PUT the
      // temp file — the whole video never sits in JS memory.
      const base64 = await FileSystem.readAsStringAsync(picked.uri, {
        encoding: FileSystem.EncodingType.Base64,
        position: uploaded,
        length,
      });
      const tempUri = `${FileSystem.cacheDirectory}hosted-part-${partNumber}.bin`;
      await FileSystem.writeAsStringAsync(tempUri, base64, {
        encoding: FileSystem.EncodingType.Base64,
      });
      try {
        const { url } = await callR2Upload({
          action: 'sign-part',
          key,
          upload_id: uploadId,
          part_number: partNumber,
        });
        if (!url) throw new Error('The upload signer returned no part URL.');
        const base = uploaded;
        const etag = await putFile(url, tempUri, contentType, (loaded) =>
          onProgress?.({ loadedBytes: base + loaded, totalBytes: total }),
        );
        if (!etag) throw new Error(`Part ${partNumber} returned no ETag.`);
        parts.push({ partNumber, etag });
      } finally {
        await FileSystem.deleteAsync(tempUri, { idempotent: true }).catch(() => undefined);
      }
      uploaded += length;
    }
    await callR2Upload({ action: 'complete', key, upload_id: uploadId, parts });
    onProgress?.({ loadedBytes: total, totalBytes: total });
  } catch (e) {
    await callR2Upload({ action: 'abort', key, upload_id: uploadId }).catch(() => undefined);
    throw e;
  }
}
