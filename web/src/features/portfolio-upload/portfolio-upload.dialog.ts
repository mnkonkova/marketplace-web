import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnDestroy,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { NzInputModule } from 'ng-zorro-antd/input';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzProgressModule } from 'ng-zorro-antd/progress';
import { NZ_MODAL_DATA, NzModalRef } from 'ng-zorro-antd/modal';
import { firstValueFrom } from 'rxjs';

import { MeRepository } from '@entities/me/repository/me.repository';
import {
  putFileToPresignedUrl,
  uploadMultipart,
  UploadProgress,
} from '@entities/me/repository/me-upload';
import { PortfolioItem } from '@entities/specialist/model/specialist.types';
import { Category } from '@entities/category/model/category.types';

const MAX_BYTES = 200 * 1024 * 1024;
/** Файлы крупнее этого лимита грузим через S3 multipart (бэк: > 5 МБ). */
const MULTIPART_THRESHOLD = 5 * 1024 * 1024;
const ALLOWED_TYPES = /^video\/(mp4|quicktime)$/;
const THUMB_SECOND = 1.5;
const ETA_WINDOW = 5;

export interface PortfolioUploadDialogData {
  /** Категории профиля — пользователь подкидывает любое подмножество к ролику. */
  categories: Category[];
  primaryCategory: string;
  selectedCategoryCodes: string[];
  /** Файл, переданный извне (drop/capture в кабинете) — автостарт upload. */
  initialFile?: File;
}

export interface PortfolioUploadDialogResult {
  created: PortfolioItem;
}

@Component({
  selector: 'app-portfolio-upload-dialog',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    NzInputModule,
    NzButtonModule,
    NzProgressModule,
  ],
  templateUrl: './portfolio-upload.dialog.html',
  styleUrl: './portfolio-upload.dialog.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PortfolioUploadDialog implements OnDestroy {
  private readonly modalRef = inject<NzModalRef<PortfolioUploadDialog, PortfolioUploadDialogResult | null>>(NzModalRef);
  private readonly data = inject<PortfolioUploadDialogData>(NZ_MODAL_DATA);
  private readonly meRepo = inject(MeRepository);

  public readonly fileInput = viewChild<ElementRef<HTMLInputElement>>('fileInput');

  public readonly file = signal<File | null>(null);
  public readonly previewUrl = signal<string | null>(null);
  public readonly thumbnailPreviewUrl = signal<string | null>(null);

  public readonly uploading = signal(false);
  public readonly saving = signal(false);
  public readonly progressPercent = signal(0);
  public readonly errorText = signal('');

  public readonly title = signal('');
  public readonly description = signal('');
  public readonly selectedCategoryCodes = signal<Set<string>>(
    new Set(this.data.primaryCategory ? [this.data.primaryCategory] : []),
  );

  /** Категории, доступные для этого ролика — те, что выбраны у профиля. */
  public readonly availableCategories = computed<Category[]>(() => {
    const allowed = new Set(this.data.selectedCategoryCodes);
    return this.data.categories.filter((c) => allowed.has(c.code));
  });

  public readonly titlePlaceholder = signal('Например: Реклама для бренда X');

  public readonly uploadedVideoUrl = signal('');
  public readonly uploadedThumbnailUrl = signal('');
  private videoAbort?: AbortController;
  private thumbAbort?: AbortController;

  /** История {timestamp_ms, loaded_bytes} для расчёта скорости. */
  private progressSamples: { t: number; loaded: number }[] = [];
  private speedBytesPerSec = signal(0);
  private etaSeconds = signal<number | null>(null);

  public readonly progressStatus = computed<'normal' | 'success' | 'exception'>(() => {
    if (this.errorText()) return 'exception';
    if (this.progressPercent() >= 100) return 'success';
    return 'normal';
  });

  public readonly speedText = computed<string | null>(() => {
    const bps = this.speedBytesPerSec();
    if (!bps) return null;
    return `${formatBytes(bps)}/с`;
  });

  public readonly etaText = computed<string | null>(() => {
    const s = this.etaSeconds();
    if (s == null) return null;
    if (s < 60) return `осталось ~${Math.max(1, Math.round(s))} с`;
    return `осталось ~${Math.round(s / 60)} мин`;
  });

  public readonly canSave = computed(
    () =>
      !!this.uploadedVideoUrl() &&
      this.title().trim().length > 0 &&
      !this.uploading() &&
      !this.saving(),
  );

  constructor() {
    const init = this.data.initialFile;
    if (init) queueMicrotask(() => this.applyFile(init));
  }

  public ngOnDestroy(): void {
    this.cleanup();
  }

  public pickFile(): void {
    this.fileInput()?.nativeElement.click();
  }

  public onFilePicked(ev: Event): void {
    const input = ev.target as HTMLInputElement;
    const f = input.files?.[0];
    input.value = '';
    if (f) this.applyFile(f);
  }

  /** Приватный единый путь: и file-input, и initialFile из вне — оба сюда. */
  private applyFile(f: File): void {
    if (!ALLOWED_TYPES.test(f.type)) {
      this.errorText.set('Видео: поддерживаем mp4 и mov.');
      return;
    }
    if (f.size > MAX_BYTES) {
      this.errorText.set('Видео больше 200 МБ.');
      return;
    }

    this.errorText.set('');
    this.file.set(f);
    this.previewUrl.set(URL.createObjectURL(f));

    const suggested = deriveHumanTitle(f.name);
    if (suggested) this.title.set(suggested);
    else this.titlePlaceholder.set('Например: Реклама для бренда X');

    void this.startUpload(f);
  }

  public toggleCategory(code: string): void {
    const next = new Set(this.selectedCategoryCodes());
    if (next.has(code)) next.delete(code);
    else next.add(code);
    this.selectedCategoryCodes.set(next);
  }

  public cancel(): void {
    this.videoAbort?.abort();
    this.thumbAbort?.abort();
    this.cleanup();
    this.modalRef.close(null);
  }

  public save(): void {
    if (!this.canSave()) return;
    this.saving.set(true);
    this.errorText.set('');
    this.meRepo
      .addPortfolio({
        title: this.title().trim(),
        description: this.description().trim(),
        video_url: this.uploadedVideoUrl(),
        thumbnail_url: this.uploadedThumbnailUrl(),
        category_codes: [...this.selectedCategoryCodes()],
      })
      .subscribe({
        next: (created) => {
          this.cleanup();
          this.modalRef.close({ created });
        },
        error: (err) => {
          this.saving.set(false);
          this.errorText.set(humanizeError(err, 'Не удалось сохранить ролик'));
        },
      });
  }

  public formatSize(bytes: number): string {
    return formatBytes(bytes);
  }

  private async startUpload(file: File): Promise<void> {
    this.uploading.set(true);
    this.progressPercent.set(0);
    this.progressSamples = [];
    this.speedBytesPerSec.set(0);
    this.etaSeconds.set(null);

    this.videoAbort = new AbortController();
    this.thumbAbort = new AbortController();

    // Видео — критично, ждём перед разморозкой кнопки. Thumbnail — best-effort
    // в фоне: если PUT к S3 виснет (CORS / медленная сеть), сохранение видео
    // всё равно возможно (бэк не требует thumbnail_url).
    // Раньше thumbP блокировал Promise.all → uploading=true навсегда.
    this.extractThumbnail(file)
      .then((blob) => {
        if (!blob) return;
        const previewURL = URL.createObjectURL(blob);
        this.thumbnailPreviewUrl.set(previewURL);
        return this.uploadThumbnail(blob, this.thumbAbort!.signal).then((url) => {
          this.uploadedThumbnailUrl.set(url);
        });
      })
      .catch(() => {
        // Thumbnail — best-effort, сохранение всё равно возможно.
      });

    try {
      const url = await this.uploadVideo(file, this.videoAbort.signal);
      this.uploadedVideoUrl.set(url);
      this.uploading.set(false);
    } catch (err) {
      this.uploading.set(false);
      const msg = (err as Error)?.message ?? '';
      if (msg === 'upload_aborted') {
        this.errorText.set('Загрузка отменена.');
      } else {
        this.errorText.set(`Не удалось загрузить видео: ${msg || 'unknown'}`);
      }
    }
  }

  private async uploadVideo(file: File, signal: AbortSignal): Promise<string> {
    if (file.size > MULTIPART_THRESHOLD) {
      // S3 multipart: бэк выдаёт upload_id и presigned PUT для каждой части.
      return uploadMultipart(
        file,
        {
          start: async (f) => {
            const r = await firstValueFrom(this.meRepo.multipartStart(f));
            return {
              uploadID: r.upload_id,
              key: r.key,
              publicURL: r.public_url,
              partSize: r.part_size,
            };
          },
          partURL: async ({ key, uploadID, partNumber }) => {
            const r = await firstValueFrom(
              this.meRepo.multipartPartURL({ key, upload_id: uploadID, part_number: partNumber }),
            );
            return r.upload_url;
          },
          complete: async ({ key, uploadID, parts }) => {
            await firstValueFrom(
              this.meRepo.multipartComplete({
                key,
                upload_id: uploadID,
                parts: parts.map((p) => ({ part_number: p.partNumber, etag: p.etag })),
              }),
            );
          },
          abort: async ({ key, uploadID }) => {
            await firstValueFrom(
              this.meRepo.multipartAbort({ key, upload_id: uploadID }),
            );
          },
        },
        {
          signal,
          // Параллелизм 2: компромисс между скоростью на стабильной сети
          // и устойчивостью на мобильной (1 сделает retry проще, но медленнее).
          concurrency: 2,
          onProgress: (p) => this.applyVideoProgress(p),
        },
      );
    }
    // Single-PUT путь для файлов ≤ 5 МБ — multipart нельзя (min part size).
    const presign = await firstValueFrom(this.meRepo.presignPortfolioUpload(file));
    await putFileToPresignedUrl(presign.upload_url, file, {
      signal,
      onProgress: (p) => this.applyVideoProgress(p),
    });
    return presign.public_url;
  }

  private async uploadThumbnail(blob: Blob, signal: AbortSignal): Promise<string> {
    // Реюзаем endpoint аватара — он принимает image/*. Отдельного thumb-эндпоинта не вводим.
    const filename = `thumb-${Date.now()}.jpg`;
    const file = new File([blob], filename, { type: 'image/jpeg' });
    const presign = await firstValueFrom(this.meRepo.presignAvatarUpload(file));
    await putFileToPresignedUrl(presign.upload_url, file, { signal });
    return presign.public_url;
  }

  private applyVideoProgress(p: UploadProgress): void {
    this.progressPercent.set(p.percent);

    const now = performance.now();
    this.progressSamples.push({ t: now, loaded: p.loaded });
    if (this.progressSamples.length > ETA_WINDOW) this.progressSamples.shift();

    if (this.progressSamples.length >= 2 && p.total > 0) {
      const first = this.progressSamples[0];
      const last = this.progressSamples[this.progressSamples.length - 1];
      const dtSec = Math.max(0.05, (last.t - first.t) / 1000);
      const dBytes = Math.max(0, last.loaded - first.loaded);
      const bps = dBytes / dtSec;
      this.speedBytesPerSec.set(bps);
      if (bps > 0) {
        const remaining = Math.max(0, p.total - last.loaded);
        this.etaSeconds.set(remaining / bps);
      }
    }
  }

  /**
   * Берём кадр на THUMB_SECOND секунде. На iOS Safari seek без play иногда
   * не отрисовывает кадр — обходим через muted/playsInline и canvas.
   */
  private extractThumbnail(file: File): Promise<Blob | null> {
    return new Promise((resolve) => {
      const objectUrl = URL.createObjectURL(file);
      const video = document.createElement('video');
      video.muted = true;
      video.playsInline = true;
      video.preload = 'auto';
      // НЕ ставим crossOrigin='anonymous' для blob: URL — это маркирует
      // canvas как tainted на iOS Safari и canvas.toBlob возвращает null.
      video.src = objectUrl;

      // iOS Safari требует видео в DOM для metadata/seek. Off-screen но
      // в дереве — обычно достаточно.
      video.style.cssText = 'position:fixed;left:-9999px;width:1px;height:1px;';
      document.body.appendChild(video);

      let timeoutId: ReturnType<typeof setTimeout> | undefined;

      const cleanup = (): void => {
        if (timeoutId) clearTimeout(timeoutId);
        URL.revokeObjectURL(objectUrl);
        video.removeAttribute('src');
        video.load();
        video.remove();
      };

      const giveUp = (): void => {
        cleanup();
        resolve(null);
      };

      // 8 секунд на всё (на iOS .mov с HEVC seek может затыкать) — иначе
      // thumbnail не блокирует флоу.
      timeoutId = setTimeout(giveUp, 8000);

      video.addEventListener('error', giveUp, { once: true });
      video.addEventListener(
        'loadedmetadata',
        () => {
          const target = Math.min(THUMB_SECOND, Math.max(0, video.duration * 0.1));
          // iOS quirk: иногда нужен play+pause чтобы seek работал.
          video.play().catch(() => {});
          video.currentTime = target;
        },
        { once: true },
      );
      video.addEventListener(
        'seeked',
        () => {
          video.pause();
          try {
            const canvas = document.createElement('canvas');
            canvas.width = video.videoWidth || 720;
            canvas.height = video.videoHeight || 1280;
            const ctx = canvas.getContext('2d');
            if (!ctx) {
              giveUp();
              return;
            }
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            canvas.toBlob(
              (blob) => {
                cleanup();
                resolve(blob);
              },
              'image/jpeg',
              0.85,
            );
          } catch {
            giveUp();
          }
        },
        { once: true },
      );
    });
  }

  private cleanup(): void {
    const u = this.previewUrl();
    if (u) URL.revokeObjectURL(u);
    this.previewUrl.set(null);
    const t = this.thumbnailPreviewUrl();
    if (t) URL.revokeObjectURL(t);
    this.thumbnailPreviewUrl.set(null);
  }
}

/** Имя файла из камеры — мусор. Возвращает '' если осмысленного title не вышло. */
function deriveHumanTitle(filename: string): string {
  const base = filename.replace(/\.[^.]+$/, '').trim();
  if (!base || base.length < 3) return '';
  // DSC_0042, IMG-1234, MVI0001, VID20240101, GOPR1234, P_0001, DSCF1234
  if (/^(dsc|dscf|img|mvi|vid|mov|gopr|gh|p)[-_ ]?\d+/i.test(base)) return '';
  if (/^[a-f0-9]{8,}$/i.test(base)) return ''; // hex hash
  if (/^\d{8,}$/.test(base)) return ''; // timestamp-like
  return base;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${Math.round(bytes)} Б`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} КБ`;
  return `${(bytes / 1024 / 1024).toFixed(1)} МБ`;
}

function humanizeError(err: unknown, fallback: string): string {
  const e = err as { error?: { error?: string; message?: string }; message?: string };
  return e?.error?.message || e?.error?.error || e?.message || fallback;
}
