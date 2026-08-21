import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CdkDragDrop, DragDropModule, moveItemInArray } from '@angular/cdk/drag-drop';
import { NzInputModule } from 'ng-zorro-antd/input';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzProgressModule } from 'ng-zorro-antd/progress';
import { NzMessageService } from 'ng-zorro-antd/message';
import { NZ_MODAL_DATA, NzModalRef } from 'ng-zorro-antd/modal';
import { firstValueFrom } from 'rxjs';

import { MeRepository } from '@entities/me/repository/me.repository';
import { putFileToPresignedUrl } from '@entities/me/repository/me-upload';
import { PortfolioItem } from '@entities/specialist/model/specialist.types';
import { PortfolioPhotoRef } from '@entities/me/model/me.types';
import { Category } from '@entities/category/model/category.types';
import { resizeImageToBlob } from '@shared/image/resize';

const MAX_IMAGES = 10;
const MAX_BYTES_PER_FILE = 30 * 1024 * 1024; // до ресайза. После canvas-resize всё <500KB.
const RESIZE_MAX = 1920;
const RESIZE_QUALITY = 0.85;
// Принимаем стандартные форматы + HEIC (iOS). HEIC браузер не декодит, но
// createImageBitmap у iOS Safari 16.4+ открывает; иначе фолбэк <img> упадёт
// и кадр будет отмечен errored.
const ACCEPT = 'image/jpeg,image/png,image/webp,image/heic,image/heif';

export interface PhotoSetUploadDialogData {
  categories: Category[];
  primaryCategory: string;
  selectedCategoryCodes: string[];
  /** Файлы, переданные снаружи (drag-and-drop в cabinet) — авто-добавляем. */
  initialFiles?: File[];
}

export interface PhotoSetUploadDialogResult {
  created: PortfolioItem;
}

interface PhotoSlot {
  id: number;
  file: File;
  previewUrl: string;
  status: 'pending' | 'uploading' | 'done' | 'error';
  progressPercent: number;
  uploadedURL?: string;
  width?: number;
  height?: number;
  errorText?: string;
}

let slotSeq = 0;

@Component({
  selector: 'app-photoset-upload-dialog',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    DragDropModule,
    NzInputModule,
    NzButtonModule,
    NzProgressModule,
  ],
  templateUrl: './photoset-upload.dialog.html',
  styleUrl: './photoset-upload.dialog.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PhotoSetUploadDialog {
  private readonly modalRef =
    inject<NzModalRef<PhotoSetUploadDialog, PhotoSetUploadDialogResult | null>>(NzModalRef);
  private readonly data = inject<PhotoSetUploadDialogData>(NZ_MODAL_DATA);
  private readonly meRepo = inject(MeRepository);
  private readonly msg = inject(NzMessageService);

  public readonly fileInput = viewChild<ElementRef<HTMLInputElement>>('fileInput');

  public readonly slots = signal<PhotoSlot[]>([]);
  public readonly title = signal('');
  public readonly description = signal('');
  public readonly saving = signal(false);
  public readonly errorText = signal('');

  public readonly selectedCategoryCodes = signal<Set<string>>(
    new Set(this.data.primaryCategory ? [this.data.primaryCategory] : []),
  );

  public readonly availableCategories = computed<Category[]>(() => {
    const allowed = new Set(this.data.selectedCategoryCodes);
    return this.data.categories.filter((c) => allowed.has(c.code));
  });

  public readonly hasSlots = computed(() => this.slots().length > 0);
  public readonly canAddMore = computed(() => this.slots().length < MAX_IMAGES);
  public readonly uploadingCount = computed(
    () => this.slots().filter((s) => s.status === 'uploading' || s.status === 'pending').length,
  );
  public readonly doneCount = computed(
    () => this.slots().filter((s) => s.status === 'done').length,
  );
  public readonly canSave = computed(
    () =>
      this.title().trim().length > 0 &&
      this.doneCount() > 0 &&
      this.uploadingCount() === 0 &&
      !this.saving(),
  );

  public readonly maxImages = MAX_IMAGES;

  constructor() {
    const init = this.data.initialFiles;
    if (init && init.length > 0) {
      const room = MAX_IMAGES;
      // queueMicrotask чтобы не блокировать конструктор синхронно — даём
      // диалогу отрендериться, потом начинаем upload'ы.
      queueMicrotask(() => {
        for (const f of init.slice(0, room)) {
          void this.addFile(f);
        }
      });
    }
  }

  public pickFiles(): void {
    this.fileInput()?.nativeElement.click();
  }

  public onFilesPicked(ev: Event): void {
    const input = ev.target as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    input.value = '';
    if (files.length === 0) return;
    this.errorText.set('');
    const room = MAX_IMAGES - this.slots().length;
    if (files.length > room) {
      this.msg.warning(`Максимум ${MAX_IMAGES} фото на кейс — лишние не добавлены.`);
    }
    for (const f of files.slice(0, room)) {
      void this.addFile(f);
    }
  }

  public removeSlot(slot: PhotoSlot): void {
    URL.revokeObjectURL(slot.previewUrl);
    this.slots.set(this.slots().filter((s) => s.id !== slot.id));
  }

  public onSlotsReorder(ev: CdkDragDrop<unknown>): void {
    if (ev.previousIndex === ev.currentIndex) return;
    const arr = [...this.slots()];
    moveItemInArray(arr, ev.previousIndex, ev.currentIndex);
    this.slots.set(arr);
  }

  public toggleCategory(code: string): void {
    const next = new Set(this.selectedCategoryCodes());
    if (next.has(code)) next.delete(code);
    else next.add(code);
    this.selectedCategoryCodes.set(next);
  }

  public cancel(): void {
    for (const s of this.slots()) URL.revokeObjectURL(s.previewUrl);
    this.modalRef.close(null);
  }

  public save(): void {
    if (!this.canSave()) return;
    const ready: PortfolioPhotoRef[] = this.slots()
      .filter((s) => s.status === 'done' && s.uploadedURL)
      .map((s) => ({ image_url: s.uploadedURL!, width: s.width, height: s.height }));
    if (ready.length === 0) return;
    this.saving.set(true);
    this.errorText.set('');
    this.meRepo
      .addPortfolioPhotoSet({
        title: this.title().trim(),
        description: this.description().trim(),
        category_codes: [...this.selectedCategoryCodes()],
        profile_categories: this.data.categories.map((c) => c.code),
        images: ready,
      })
      .subscribe({
        next: (created) => {
          for (const s of this.slots()) URL.revokeObjectURL(s.previewUrl);
          this.modalRef.close({ created });
        },
        error: (err) => {
          this.saving.set(false);
          this.errorText.set(humanizeError(err, 'Не удалось сохранить фото-кейс'));
        },
      });
  }

  private async addFile(file: File): Promise<void> {
    if (file.size > MAX_BYTES_PER_FILE) {
      const sizeMB = (file.size / (1024 * 1024)).toFixed(0);
      this.msg.error(
        `Файл ${sizeMB} МБ — слишком большой. До ${MAX_BYTES_PER_FILE / 1024 / 1024} МБ.`,
      );
      return;
    }
    const slot: PhotoSlot = {
      id: ++slotSeq,
      file,
      previewUrl: URL.createObjectURL(file),
      status: 'pending',
      progressPercent: 0,
    };
    this.slots.set([...this.slots(), slot]);
    try {
      // Resize в canvas → baseline JPEG ≤1920px, ~250КБ. Решает HEIC/EXIF/iOS
      // progressive — те же причины что и для аватара.
      const {
        file: resized,
        width,
        height,
      } = await resizeImageToBlob(file, RESIZE_MAX, RESIZE_QUALITY);
      this.patchSlot(slot.id, { status: 'uploading', width, height });
      const presign = await firstValueFrom(this.meRepo.presignAvatarUpload(resized));
      await putFileToPresignedUrl(presign.upload_url, resized, {
        onProgress: (p) => this.patchSlot(slot.id, { progressPercent: p.percent }),
      });
      this.patchSlot(slot.id, {
        status: 'done',
        progressPercent: 100,
        uploadedURL: presign.public_url,
      });
    } catch (err) {
      const msg = (err as Error)?.message ?? 'unknown';
      this.patchSlot(slot.id, {
        status: 'error',
        errorText: `Не удалось загрузить: ${msg}`,
      });
    }
  }

  private patchSlot(id: number, patch: Partial<PhotoSlot>): void {
    this.slots.set(this.slots().map((s) => (s.id === id ? { ...s, ...patch } : s)));
  }

  public readonly accept = ACCEPT;
}

function humanizeError(err: unknown, fallback: string): string {
  const e = err as { error?: { error?: string; message?: string }; message?: string };
  return e?.error?.message || e?.error?.error || e?.message || fallback;
}
