export interface UploadProgress {
  /** loaded байт */
  loaded: number;
  /** total байт (если знаем) */
  total: number;
  /** проценты 0..100 */
  percent: number;
}

export interface PutFileOptions {
  onProgress?: (p: UploadProgress) => void;
  /** AbortSignal — abort() прерывает XHR. */
  signal?: AbortSignal;
}

/** Прямая загрузка файла/блоба по presigned URL (вне HttpClient). */
export function putFileToPresignedUrl(
  uploadURL: string,
  file: Blob,
  optsOrLegacy?: PutFileOptions | ((percent: number) => void),
): Promise<void> {
  // Назад-совместимость: старая сигнатура (uploadURL, file, onProgress: (n)=>void).
  const opts: PutFileOptions =
    typeof optsOrLegacy === 'function'
      ? { onProgress: (p) => optsOrLegacy(p.percent) }
      : (optsOrLegacy ?? {});

  return new Promise((resolve, reject) => {
    if (opts.signal?.aborted) {
      reject(new Error('upload_aborted'));
      return;
    }
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', uploadURL);
    xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable || !opts.onProgress) return;
      opts.onProgress({
        loaded: event.loaded,
        total: event.total,
        percent: Math.round((event.loaded / event.total) * 100),
      });
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new Error(`upload_${xhr.status}`));
    };
    xhr.onerror = () => reject(new Error('upload_failed'));
    xhr.onabort = () => reject(new Error('upload_aborted'));
    const onAbort = (): void => xhr.abort();
    opts.signal?.addEventListener('abort', onAbort, { once: true });
    xhr.onloadend = () => opts.signal?.removeEventListener('abort', onAbort);
    xhr.send(file);
  });
}
