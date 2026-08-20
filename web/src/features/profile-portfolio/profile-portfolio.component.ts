import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { CdkDragDrop, DragDropModule, moveItemInArray } from '@angular/cdk/drag-drop';
import { FormsModule } from '@angular/forms';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { NzDrawerModule } from 'ng-zorro-antd/drawer';
import { NzDropDownModule } from 'ng-zorro-antd/dropdown';
import { NzInputModule } from 'ng-zorro-antd/input';
import { NzMessageService } from 'ng-zorro-antd/message';
import { NzModalService } from 'ng-zorro-antd/modal';
import { EMPTY, firstValueFrom } from 'rxjs';
import { catchError } from 'rxjs/operators';

import { Category } from '@entities/category/model/category.types';
import { MeRepository } from '@entities/me/repository/me.repository';
import { putFileToPresignedUrl } from '@entities/me/repository/me-upload';
import { PortfolioItem } from '@entities/specialist/model/specialist.types';
import {
  PhotoSetUploadDialog,
  PhotoSetUploadDialogData,
  PhotoSetUploadDialogResult,
} from '@features/portfolio-upload/photoset-upload.dialog';
import {
  PortfolioUploadDialog,
  PortfolioUploadDialogData,
  PortfolioUploadDialogResult,
} from '@features/portfolio-upload/portfolio-upload.dialog';
import { ApiErrorBody, apiErrorMessage } from '@shared/api/api-error';
import { resizeImageToBlob } from '@shared/image/resize';
import { formatDuration } from '@shared/lib/format';
import { aspectLabel, knownRatio, orientationOf, posterSrc } from '@shared/lib/portfolio-media';
import { MeasureAspectDirective } from '@shared/ui/measure-aspect.directive';

const MAX_PHOTOS_PER_SET = 10;

/**
 * Вкладка «Портфолио»: загрузка работ, список, промо-работа (флагман) и
 * слот горизонтального шоурила.
 *
 * Список работ принадлежит странице `/me` (его же читает индикатор
 * заполненности), поэтому компонент не грузит его сам, а сообщает об
 * изменениях наверх: `itemsChange` — оптимистичное обновление,
 * `reloadRequested` — «перечитай с сервера», `profileTouched` — «бэкенд
 * бампнул specialist_profiles.updated_at, обнови optimistic-lock».
 */
@Component({
  selector: 'app-profile-portfolio',
  standalone: true,
  imports: [
    DragDropModule,
    FormsModule,
    MeasureAspectDirective,
    NzButtonModule,
    NzIconModule,
    NzInputModule,
    NzDropDownModule,
    NzDrawerModule,
  ],
  templateUrl: './profile-portfolio.component.html',
  styleUrl: './profile-portfolio.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProfilePortfolioComponent {
  private readonly meRepo = inject(MeRepository);

  private readonly msg = inject(NzMessageService);

  private readonly modalService = inject(NzModalService);

  public readonly items = input<PortfolioItem[]>([]);

  public readonly categories = input<Category[]>([]);

  /** Категории профиля — из них набираются теги конкретной работы. */
  public readonly profileCategories = input<Set<string>>(new Set());

  public readonly primaryCategory = input<string>('');

  /** Ссылка на публичную страницу для «Как видят клиенты». */
  public readonly publicUrl = input<string>('');

  public readonly itemsChange = output<PortfolioItem[]>();

  public readonly reloadRequested = output<void>();

  public readonly profileTouched = output<void>();

  public readonly maxPhotosPerSet = MAX_PHOTOS_PER_SET;

  public readonly dragOver = signal(false);

  public readonly savingMeta = signal(false);

  public readonly featuredBusyId = signal<string | null>(null);

  public readonly editingItemId = signal<string | null>(null);

  public editTitle = '';

  public editDescription = '';

  /**
   * Форматы, измеренные на клиенте: у работ старше миграции 00028 бэк не
   * отдаёт `aspect`, и без замера бейдж формата врал бы «вертикальное»
   * (это формат по умолчанию, ошибка была бы незаметной).
   */
  private readonly measured = signal<Record<string, number>>({});

  private readonly appendPhotosInput = viewChild<ElementRef<HTMLInputElement>>('appendPhotosInput');

  private appendTargetItemId: string | null = null;

  /** true, если следующую созданную работу надо сразу закрепить как промо. */
  private featureAfterCreate = false;

  public readonly featured = computed(() => this.items().find((i) => i.is_featured) ?? null);

  /**
   * Горизонтальный шоурил — это закреплённая работа формата 16:9: публичная
   * страница ставит её широким баннером вместо вертикального флагмана
   * (см. widgets/portfolio-flagship).
   *
   * TODO(backend): отдельного поля «шоурил» в API нет. Если понадобится
   * разделить «промо-вертикаль» и «шоурил-баннер» (показывать оба сразу),
   * нужен второй флаг у portfolio_items либо ссылка на профиле.
   */
  public readonly showreel = computed(() => {
    const f = this.featured();
    if (!f) return null;
    return this.orientation(f) === 'horizontal' ? f : null;
  });

  public readonly categoryTitles = computed(() => {
    const map: Record<string, string> = {};
    for (const c of this.categories()) map[c.code] = c.title;
    return map;
  });

  public readonly profileCategoryList = computed(() => [...this.profileCategories()]);

  /**
   * Тач-экран определяем один раз: на телефоне список тегов открывается
   * нижней шторкой, а не выпадающим меню. Выпадашка у правого края экрана
   * прижимается к границе и половина пунктов уезжает под палец.
   */
  public readonly isTouch = signal(
    typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(hover: none) and (pointer: coarse)').matches,
  );

  /** id работы, у которой открыта шторка тегов. null — шторка закрыта. */
  public readonly tagSheetId = signal<string | null>(null);

  public readonly tagSheetItem = computed(() => {
    const id = this.tagSheetId();
    return id ? (this.items().find((i) => i.id === id) ?? null) : null;
  });

  public openTagSheet(item: PortfolioItem): void {
    this.tagSheetId.set(item.id);
  }

  public closeTagSheet(): void {
    this.tagSheetId.set(null);
    this.sheetShift = 0;
  }

  // === Смахивание шторки ===
  //
  // Крестик на телефоне — лишний прицел: шторку закрывают жестом вниз, как
  // в системных меню. Тянем саму панель ng-zorro (её обёртку в оверлее),
  // чтобы жест был с обратной связью, а не «дёрнул — угадал».

  private sheetStartY = 0;

  private sheetShift = 0;

  private sheetPanel(): HTMLElement | null {
    return document.querySelector('.ant-drawer-content-wrapper');
  }

  public onSheetTouchStart(ev: TouchEvent): void {
    this.sheetStartY = ev.touches[0].clientY;
    this.sheetShift = 0;
    const panel = this.sheetPanel();
    if (panel) panel.style.transition = 'none';
  }

  public onSheetTouchMove(ev: TouchEvent): void {
    // Тянем только вниз: вверх шторка не растёт.
    const dy = Math.max(0, ev.touches[0].clientY - this.sheetStartY);
    this.sheetShift = dy;
    const panel = this.sheetPanel();
    if (panel) panel.style.transform = `translateY(${dy}px)`;
  }

  public onSheetTouchEnd(): void {
    const panel = this.sheetPanel();
    if (panel) {
      panel.style.transition = '';
      panel.style.transform = '';
    }
    // 90px — примерно треть высоты шторки: случайным движением не закроешь.
    if (this.sheetShift > 90) this.closeTagSheet();
    this.sheetShift = 0;
  }

  /** Сколько тегов показываем на карточке до «ещё N». */
  private static readonly VISIBLE_TAGS = 3;

  public shownTags(item: PortfolioItem): string[] {
    return (item.category_codes ?? []).slice(0, ProfilePortfolioComponent.VISIBLE_TAGS);
  }

  public hiddenTagCount(item: PortfolioItem): number {
    return Math.max(0, (item.category_codes?.length ?? 0) - ProfilePortfolioComponent.VISIBLE_TAGS);
  }

  /** Спрятанные теги — в title, чтобы не открывать меню ради подглядывания. */
  public hiddenTagTitles(item: PortfolioItem): string {
    return (item.category_codes ?? [])
      .slice(ProfilePortfolioComponent.VISIBLE_TAGS)
      .map((c) => this.categoryTitle(c))
      .join(', ');
  }

  public categoryTitle(code: string): string {
    return this.categoryTitles()[code] ?? code;
  }

  public poster(item: PortfolioItem): string {
    return posterSrc(item);
  }

  public duration(item: PortfolioItem): string {
    return formatDuration(item.duration_sec);
  }

  public onMeasured(item: PortfolioItem, ratio: number): void {
    if (this.measured()[item.id] === ratio) return;
    this.measured.update((m) => ({ ...m, [item.id]: ratio }));
  }

  private ratio(item: PortfolioItem): number | null {
    return knownRatio(item) ?? this.measured()[item.id] ?? null;
  }

  public orientation(item: PortfolioItem): 'vertical' | 'horizontal' | 'square' | 'unknown' {
    const r = this.ratio(item);
    return r == null ? 'unknown' : orientationOf(r);
  }

  /**
   * Бейдж формата — только для показа. Формат берётся из файла (ffprobe на
   * бэке, клиентский замер как фолбэк) и вручную не редактируется: плитка
   * публичной страницы читает ровно это же значение.
   */
  /** Горизонтальная работа — обложка шире и ниже (170x96 против 92x140). */
  public isHorizontal(item: PortfolioItem): boolean {
    const r = this.ratio(item);
    return r != null && orientationOf(r) === 'horizontal';
  }

  public formatBadge(item: PortfolioItem): string {
    const r = this.ratio(item);
    if (r == null) return '';
    // Только соотношение: словом «вертикаль» бейдж не помещался на обложку
    // 92px и переносился на две строки. Ориентация и так видна по картинке.
    return aspectLabel(r);
  }

  /** Полная подпись формата — в title, для тех, кому нужно словами. */
  public formatTitle(item: PortfolioItem): string {
    const r = this.ratio(item);
    if (r == null) return '';
    const kind = orientationOf(r);
    const human = kind === 'horizontal' ? 'горизонт' : kind === 'square' ? 'квадрат' : 'вертикаль';
    return `${aspectLabel(r)} · ${human} — формат определяется из файла`;
  }

  // === Промо-работа ===

  public toggleFeatured(item: PortfolioItem): void {
    const next = !item.is_featured;
    this.featuredBusyId.set(item.id);
    this.meRepo
      .setPortfolioFeatured(item.id, next)
      .pipe(
        catchError((err) => {
          this.featuredBusyId.set(null);
          this.msg.error(apiErrorMessage(err?.error ?? null, 'Не удалось закрепить работу'));
          return EMPTY;
        }),
      )
      .subscribe((updated) => {
        this.featuredBusyId.set(null);
        // Radio-логика: закреплённая всегда одна. Бэк снял флаг с прежней
        // в той же транзакции — повторяем это локально, без перезагрузки.
        this.itemsChange.emit(
          this.items().map((p) =>
            p.id === updated.id ? { ...p, ...updated } : { ...p, is_featured: false },
          ),
        );
        this.msg.success(next ? 'Работа закреплена как промо' : 'Промо снято');
      });
  }

  // === Загрузка ===

  public onDragEnter(ev: DragEvent): void {
    if (!ev.dataTransfer?.types.includes('Files')) return;
    ev.preventDefault();
    this.dragOver.set(true);
  }

  public onDragOver(ev: DragEvent): void {
    if (!ev.dataTransfer?.types.includes('Files')) return;
    ev.preventDefault();
    ev.dataTransfer.dropEffect = 'copy';
  }

  public onDragLeave(ev: DragEvent): void {
    // dragleave срабатывает и на детях — игнорим если ушли на ребёнка
    const related = ev.relatedTarget as Node | null;
    if (related && (ev.currentTarget as HTMLElement).contains(related)) return;
    this.dragOver.set(false);
  }

  public onDrop(ev: DragEvent): void {
    ev.preventDefault();
    this.dragOver.set(false);
    this.routeFiles(Array.from(ev.dataTransfer?.files ?? []));
  }

  public onFilesPicked(ev: Event): void {
    const input = ev.target as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    input.value = '';
    this.routeFiles(files);
  }

  /** Шоурил — тот же upload видео, но созданная работа сразу становится промо. */
  public onShowreelPicked(ev: Event): void {
    const input = ev.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    this.featureAfterCreate = true;
    this.openUploadDialog(file);
  }

  // routeFiles — единая логика «куда дальше» по типу файлов:
  //   • все картинки → photo-set (диалог с авто-добавленными файлами)
  //   • первый файл — видео → video-upload (берём только этот файл; остальные
  //     видео-айтемы заводятся как отдельные работы, batch не предусмотрен)
  //   • смешано (фото + видео) → берём фото как photo-set + warning что
  //     видео нужно отдельной загрузкой (избегаем потери информации без
  //     явной отметки юзеру)
  private routeFiles(files: File[]): void {
    if (files.length === 0) return;
    const isImage = (f: File) => /^image\//.test(f.type) || /\.(heic|heif)$/i.test(f.name);
    const isVideo = (f: File) => /^video\//.test(f.type) || /\.(mp4|mov|m4v)$/i.test(f.name);

    const images = files.filter(isImage);
    const videos = files.filter(isVideo);

    if (images.length > 0 && videos.length === 0) {
      this.openPhotoSetDialog(images);
      return;
    }
    if (videos.length > 0 && images.length === 0) {
      if (videos.length > 1) {
        this.msg.warning(
          'Видео загружаются по одному. Открываю первое — остальные загрузите следующими.',
        );
      }
      this.openUploadDialog(videos[0]);
      return;
    }
    if (images.length > 0 && videos.length > 0) {
      this.msg.warning(
        'Видео и фото нельзя в одну загрузку. Открыл фото-кейс — видео загрузите отдельно.',
      );
      this.openPhotoSetDialog(images);
      return;
    }
    // Ничего не распознано
    this.msg.error('Поддерживаются только видео (MP4/MOV) и фото (JPG/PNG/WEBP/HEIC).');
  }

  public openUploadDialog(initialFile?: File): void {
    const featureAfter = this.featureAfterCreate;
    this.featureAfterCreate = false;
    const ref = this.modalService.create<
      PortfolioUploadDialog,
      PortfolioUploadDialogData,
      PortfolioUploadDialogResult | null
    >({
      nzTitle: featureAfter ? 'Монтажный шоурил' : 'Новое видео в портфолио',
      nzContent: PortfolioUploadDialog,
      nzFooter: null,
      nzWidth: 560,
      nzClassName: 'portfolio-upload-modal',
      nzMaskClosable: false,
      nzData: {
        categories: this.categories(),
        primaryCategory: this.primaryCategory(),
        selectedCategoryCodes: this.profileCategoryList(),
        initialFile,
      },
    });
    ref.afterClose.subscribe((res: PortfolioUploadDialogResult | null | undefined) => {
      if (!res?.created) return;
      this.reloadRequested.emit();
      this.profileTouched.emit();
      if (featureAfter) {
        this.meRepo
          .setPortfolioFeatured(res.created.id, true)
          .pipe(
            catchError(() => {
              this.msg.warning(
                'Шоурил загружен, но закрепить его не удалось — нажмите «Промо» в карточке.',
              );
              return EMPTY;
            }),
          )
          .subscribe(() => {
            this.reloadRequested.emit();
            this.msg.success('Шоурил загружен и закреплён');
          });
        return;
      }
      this.msg.success('Видео добавлено');
    });
  }

  public openPhotoSetDialog(initialFiles?: File[]): void {
    this.featureAfterCreate = false;
    const ref = this.modalService.create<
      PhotoSetUploadDialog,
      PhotoSetUploadDialogData,
      PhotoSetUploadDialogResult | null
    >({
      nzTitle: 'Новый фото-кейс',
      nzContent: PhotoSetUploadDialog,
      nzFooter: null,
      nzWidth: 640,
      nzClassName: 'portfolio-upload-modal',
      nzMaskClosable: false,
      nzData: {
        categories: this.categories(),
        primaryCategory: this.primaryCategory(),
        selectedCategoryCodes: this.profileCategoryList(),
        initialFiles,
      },
    });
    ref.afterClose.subscribe((res: PhotoSetUploadDialogResult | null | undefined) => {
      if (res?.created) {
        this.reloadRequested.emit();
        this.profileTouched.emit();
        this.msg.success('Фото-кейс добавлен');
      }
    });
  }

  // === Фото внутри кейса ===

  public pickAppendPhotos(item: PortfolioItem): void {
    this.appendTargetItemId = item.id;
    this.appendPhotosInput()?.nativeElement.click();
  }

  public async onAppendPhotosPicked(ev: Event): Promise<void> {
    const input = ev.target as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    input.value = '';
    const itemId = this.appendTargetItemId;
    this.appendTargetItemId = null;
    if (!itemId || files.length === 0) return;
    const item = this.items().find((p) => p.id === itemId);
    if (!item) return;
    const room = this.maxPhotosPerSet - (item.images?.length || 0);
    if (room <= 0) {
      this.msg.warning(`Максимум ${this.maxPhotosPerSet} фото на кейс — удалите лишние`);
      return;
    }
    const toUpload = files.slice(0, room);
    if (files.length > room) {
      this.msg.warning(`Можно добавить ещё ${room} — лишние пропущены`);
    }
    // Параллельный upload каждого файла → массив PortfolioPhotoRef → POST.
    this.savingMeta.set(true);
    try {
      const refs = await Promise.all(
        toUpload.map(async (f) => {
          const { file: resized, width, height } = await resizeImageToBlob(f, 1920, 0.85);
          const presign = await firstValueFrom(this.meRepo.presignAvatarUpload(resized));
          await putFileToPresignedUrl(presign.upload_url, resized);
          return { image_url: presign.public_url, width, height };
        }),
      );
      const res = await firstValueFrom(this.meRepo.appendPortfolioImages(itemId, refs));
      this.itemsChange.emit(
        this.items().map((p) =>
          p.id === itemId
            ? {
                ...p,
                images: res.images,
                thumbnail_url: res.images[0]?.image_url || p.thumbnail_url,
                updated_at: res.updated_at, // sync optimistic-lock snapshot
              }
            : p,
        ),
      );
      this.profileTouched.emit();
      this.msg.success(`Добавлено ${refs.length} фото`);
    } catch (err) {
      this.msg.error(
        apiErrorMessage(
          (err as { error?: ApiErrorBody })?.error ?? null,
          'Не удалось добавить фото',
        ),
      );
    } finally {
      this.savingMeta.set(false);
    }
  }

  public onReorderImages(item: PortfolioItem, ev: CdkDragDrop<unknown>): void {
    if (!item.images || ev.previousIndex === ev.currentIndex) return;
    const reordered = [...item.images];
    moveItemInArray(reordered, ev.previousIndex, ev.currentIndex);
    // Оптимистично применяем на фронте — пользователь видит мгновенный отклик.
    this.itemsChange.emit(
      this.items().map((p) =>
        p.id === item.id ? { ...p, images: reordered, thumbnail_url: reordered[0].image_url } : p,
      ),
    );
    this.meRepo
      .reorderPortfolioImages(
        item.id,
        reordered.map((i) => i.id),
      )
      .subscribe({
        next: (res) => {
          // Бэк может перенумеровать sort_order и обновляет parent.updated_at —
          // синхронизируем и то, и другое (иначе следующий PATCH meta = 409).
          this.itemsChange.emit(
            this.items().map((p) =>
              p.id === item.id
                ? {
                    ...p,
                    images: res.images,
                    thumbnail_url: res.images[0]?.image_url || p.thumbnail_url,
                    updated_at: res.updated_at,
                  }
                : p,
            ),
          );
          this.profileTouched.emit();
        },
        error: (err) => {
          // Откатываем — перезагружаем с сервера.
          this.reloadRequested.emit();
          this.msg.error(apiErrorMessage(err?.error ?? null, 'Не удалось изменить порядок'));
        },
      });
  }

  public deletePhotoSetImage(item: PortfolioItem, imageId: string): void {
    this.meRepo
      .deletePortfolioImage(imageId)
      .pipe(
        catchError((err) => {
          this.msg.error(apiErrorMessage(err.error, 'Не удалось удалить фото'));
          return EMPTY;
        }),
      )
      .subscribe(() => {
        const remaining = (item.images ?? []).filter((i) => i.id !== imageId);
        if (remaining.length === 0) {
          this.itemsChange.emit(this.items().filter((p) => p.id !== item.id));
          this.profileTouched.emit();
          this.msg.success('Сет удалён — последнее фото было удалено');
          return;
        }
        // Полностью перезагружаем portfolio: backend обновляет
        // portfolio_items.updated_at при изменении cover'а, без перезагрузки
        // фронт держал бы stale snapshot → следующий PATCH meta = 409.
        this.reloadRequested.emit();
        this.profileTouched.emit();
        this.msg.success('Фото удалено');
      });
  }

  // === Название / описание ===

  public startEditMeta(item: PortfolioItem): void {
    this.editingItemId.set(item.id);
    this.editTitle = item.title || '';
    this.editDescription = item.description || '';
  }

  public cancelEditMeta(): void {
    this.editingItemId.set(null);
  }

  public saveEditMeta(item: PortfolioItem): void {
    const title = this.editTitle.trim();
    const description = this.editDescription.trim();
    // TODO(backend): PATCH /me/portfolio/{id} отклоняет пустой title
    // (ErrInvalidInput). Пока так — «без названия» на публичной возможно
    // только у работ, созданных до появления обязательного поля.
    if (!title) {
      this.msg.error('Название не может быть пустым');
      return;
    }
    if (title === (item.title || '') && description === (item.description || '')) {
      // Ничего не изменилось — закрываем без запроса.
      this.editingItemId.set(null);
      return;
    }
    this.savingMeta.set(true);
    this.meRepo
      .updatePortfolioMeta(item.id, { title, description, updated_at: item.updated_at })
      .pipe(
        catchError((err) => {
          this.savingMeta.set(false);
          this.msg.error(apiErrorMessage(err.error, 'Не удалось сохранить'));
          return EMPTY;
        }),
      )
      .subscribe((updated) => {
        this.savingMeta.set(false);
        this.itemsChange.emit(
          this.items().map((p) => (p.id === updated.id ? { ...p, ...updated } : p)),
        );
        this.editingItemId.set(null);
        this.profileTouched.emit();
        this.msg.success('Сохранено');
      });
  }

  public deleteItem(item: PortfolioItem): void {
    this.meRepo
      .deletePortfolio(item.id)
      .pipe(
        catchError((err) => {
          this.msg.error(apiErrorMessage(err.error, 'Не удалось удалить работу'));
          return EMPTY;
        }),
      )
      .subscribe(() => {
        this.itemsChange.emit(this.items().filter((p) => p.id !== item.id));
        this.profileTouched.emit();
        this.msg.success('Работа удалена');
      });
  }

  /**
   * Последний оставшийся тег снять нельзя: лента фильтрует работы по
   * category_codes через terms, и работа без тегов молча выпадает из всех
   * подборок по категориям. В общей ленте и на странице специалиста она
   * при этом видна — заметить пропажу почти невозможно.
   *
   * Это защита в интерфейсе; API пустой список пока принимает.
   * TODO(backend): SetPortfolioCategories должен отдавать ErrInvalidInput
   * на пустой codes — тогда правило будет держаться и мимо фронта.
   */
  public isLastTag(item: PortfolioItem, code: string): boolean {
    const codes = item.category_codes ?? [];
    return codes.length === 1 && codes[0] === code;
  }

  public toggleItemCategory(item: PortfolioItem, code: string): void {
    if (this.isLastTag(item, code)) {
      this.msg.info('Оставьте хотя бы один тег — иначе работа не попадёт в подборки по категориям');
      return;
    }
    const next = new Set(item.category_codes ?? []);
    if (next.has(code)) next.delete(code);
    else next.add(code);
    this.meRepo
      .updatePortfolioCategories(item.id, [...next])
      .pipe(
        catchError((err) => {
          this.msg.error(apiErrorMessage(err.error, 'Не удалось обновить теги работы'));
          return EMPTY;
        }),
      )
      .subscribe((updated) => {
        this.itemsChange.emit(this.items().map((p) => (p.id === updated.id ? updated : p)));
        // SetPortfolioCategories на бэке проходит через
        // BumpModerationToPendingIfApprovedInTx (для approved-спецов) — это
        // меняет specialist_profiles.updated_at. Без refresh следующий
        // PATCH /me/profile получит 409.
        this.profileTouched.emit();
      });
  }
}
