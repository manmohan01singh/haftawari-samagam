/**
 * Native stub: original-file uploads run from the WEB admin (the
 * advisor flow is laptop/web-first — the file lives on the admin's
 * computer). The web implementation is hostedUpload.web.ts, which
 * Metro resolves on web builds.
 */
export interface UploadProgress {
  loadedBytes: number;
  totalBytes: number;
}

export async function uploadOriginalToR2(
  _file: unknown,
  _key: string,
  _onProgress?: (p: UploadProgress) => void,
): Promise<void> {
  throw new Error(
    'Uploads run from the web admin. Open this dashboard in a browser on the computer that holds the original file.',
  );
}
