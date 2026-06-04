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

export interface MultipartUploadOptions {
  /** Прогресс по агрегированным байтам (loaded суммируется по частям). */
  onProgress?: (p: UploadProgress) => void;
  /** AbortSignal — отменяет текущий PUT и пропускает оставшиеся. */
  signal?: AbortSignal;
  /** Параллелизм upload'а частей. 1 = строго последовательно (надёжнее на 4G), 2-3 = быстрее на стабильной сети. */
  concurrency?: number;
}

export interface MultipartContext {
  /** Старт multipart на бэке. Возвращает upload_id + part_size. */
  start(file: File): Promise<{ uploadID: string; key: string; publicURL: string; partSize: number }>;
  /** Presigned PUT для конкретной части. */
  partURL(args: { key: string; uploadID: string; partNumber: number }): Promise<string>;
  /** Завершить multipart на бэке (собрать чанки). */
  complete(args: { key: string; uploadID: string; parts: { partNumber: number; etag: string }[] }): Promise<void>;
  /** Отменить multipart на бэке (S3 удалит части). */
  abort(args: { key: string; uploadID: string }): Promise<void>;
}

/**
 * Multipart upload файла. Режет File на части по partSize (приходит с бэка),
 * параллельно льёт каждую часть и собирает ETag'и, потом complete.
 * Возвращает public_url, как и single-PUT путь.
 */
export async function uploadMultipart(
  file: File,
  ctx: MultipartContext,
  opts: MultipartUploadOptions = {},
): Promise<string> {
  const { uploadID, key, publicURL, partSize } = await ctx.start(file);
  const concurrency = Math.max(1, Math.min(opts.concurrency ?? 1, 6));

  const partCount = Math.ceil(file.size / partSize);
  // Прогресс по агрегированным байтам. Каждая часть бьёт по loadedPerPart[i],
  // суммарный loaded — sum.
  const loadedPerPart = new Array<number>(partCount).fill(0);
  const emit = (): void => {
    if (!opts.onProgress) return;
    const loaded = loadedPerPart.reduce((s, x) => s + x, 0);
    opts.onProgress({
      loaded,
      total: file.size,
      percent: Math.min(100, Math.round((loaded / file.size) * 100)),
    });
  };

  const parts: { partNumber: number; etag: string }[] = [];
  let nextPartIdx = 0;
  let failed: Error | null = null;

  // Воркер: пока есть невзятая часть, берёт её, грузит, записывает ETag.
  const worker = async (): Promise<void> => {
    while (!failed) {
      const i = nextPartIdx++;
      if (i >= partCount) return;
      if (opts.signal?.aborted) {
        failed = new Error('upload_aborted');
        return;
      }
      const start = i * partSize;
      const end = Math.min(start + partSize, file.size);
      const blob = file.slice(start, end);
      const partNumber = i + 1; // S3: 1-based
      try {
        const url = await ctx.partURL({ key, uploadID, partNumber });
        const etag = await putFileToPresignedUrl(url, blob, {
          signal: opts.signal,
          onProgress: (p) => {
            loadedPerPart[i] = p.loaded;
            emit();
          },
        });
        // Стабилизируем после окончания части (на случай если progress
        // не дотянул до 100% из-за округления).
        loadedPerPart[i] = end - start;
        emit();
        if (!etag) {
          throw new Error('etag_missing — проверь bucket CORS: ExposeHeaders должен включать ETag');
        }
        parts.push({ partNumber, etag });
      } catch (e) {
        failed = e instanceof Error ? e : new Error(String(e));
        return;
      }
    }
  };

  const workers = Array.from({ length: Math.min(concurrency, partCount) }, () => worker());
  await Promise.all(workers);

  if (failed) {
    // На любую ошибку (включая abort) — пытаемся прибрать orphan-части.
    try {
      await ctx.abort({ key, uploadID });
    } catch {
      // Ignored — это лучший effort, основная ошибка уже выше.
    }
    throw failed;
  }

  parts.sort((a, b) => a.partNumber - b.partNumber);
  await ctx.complete({ key, uploadID, parts });
  return publicURL;
}

/** Прямая загрузка файла/блоба по presigned URL (вне HttpClient).
 *  Возвращает ETag из ответа S3 — нужен для multipart complete. */
export function putFileToPresignedUrl(
  uploadURL: string,
  file: Blob,
  optsOrLegacy?: PutFileOptions | ((percent: number) => void),
): Promise<string> {
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
      if (xhr.status >= 200 && xhr.status < 300) {
        // ETag требуется только для multipart-частей. S3 CORS должен
        // exposing ETag в Access-Control-Expose-Headers, иначе вернётся ''.
        resolve(xhr.getResponseHeader('ETag') ?? '');
      } else {
        reject(new Error(`upload_${xhr.status}`));
      }
    };
    xhr.onerror = () => reject(new Error('upload_failed'));
    xhr.onabort = () => reject(new Error('upload_aborted'));
    const onAbort = (): void => xhr.abort();
    opts.signal?.addEventListener('abort', onAbort, { once: true });
    xhr.onloadend = () => opts.signal?.removeEventListener('abort', onAbort);
    xhr.send(file);
  });
}
