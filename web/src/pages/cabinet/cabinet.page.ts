import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnDestroy,
  OnInit,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { CdkDragDrop, DragDropModule, moveItemInArray } from '@angular/cdk/drag-drop';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { NzSpinModule } from 'ng-zorro-antd/spin';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzInputModule } from 'ng-zorro-antd/input';
import { NzTagModule } from 'ng-zorro-antd/tag';
import { NzAlertModule } from 'ng-zorro-antd/alert';
import { NzSelectModule } from 'ng-zorro-antd/select';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { NzMessageService } from 'ng-zorro-antd/message';
import { EMPTY, Observable, firstValueFrom, forkJoin, of, throwError, timer } from 'rxjs';
import { catchError, finalize, timeout } from 'rxjs/operators';
import { AuthSessionStore } from '@entities/auth/model/auth-session.store';
import { MeUser } from '@entities/auth/model/auth.types';
import { MeRepository } from '@entities/me/repository/me.repository';
import { putFileToPresignedUrl } from '@entities/me/repository/me-upload';
import {
  MeProfile,
  MeProfileFullPatch,
  ProfileCheckResult,
  UploadURLResponse,
} from '@entities/me/model/me.types';
import { CategoryApi } from '@entities/category/api/category.api';
import { Category, Skill } from '@entities/category/model/category.types';
import { ProductionApi } from '@entities/production/api/production.api';
import { Production } from '@entities/production/model/production.types';
import { PortfolioItem } from '@entities/specialist/model/specialist.types';
import { ApiErrorBody, apiErrorMessage } from '@shared/api/api-error';
import { groupCategoriesByType } from '@shared/lib/category-groups';
import { AppHeaderComponent } from '@widgets/app-header/app-header.component';
import { NzModalService } from 'ng-zorro-antd/modal';
import {
  isEmailUnverifiedError,
  openEmailUnverifiedDialog,
} from '@features/auth/lib/open-email-unverified-dialog';
import {
  PortfolioUploadDialog,
  PortfolioUploadDialogData,
  PortfolioUploadDialogResult,
} from '@features/portfolio-upload/portfolio-upload.dialog';
import {
  PhotoSetUploadDialog,
  PhotoSetUploadDialogData,
  PhotoSetUploadDialogResult,
} from '@features/portfolio-upload/photoset-upload.dialog';
import { resizeImageToBlob } from '@shared/image/resize';
import { SOCIAL_NETWORKS, SocialKey } from '@shared/lib/social-links';
import { ProfileShareComponent } from '@features/profile-share/profile-share.component';
import { CompletenessIndicatorComponent } from '@widgets/completeness-indicator/completeness-indicator.component';

function emptySocialLinks(): Record<SocialKey, string> {
  // Все 9 ключей с пустыми значениями. Нужно чтобы ngModel мог писать
  // через `form.social_links[key]` без undefined-проблем.
  return SOCIAL_NETWORKS.reduce(
    (acc, n) => {
      acc[n.key] = '';
      return acc;
    },
    {} as Record<SocialKey, string>,
  );
}

interface ProfileForm {
  display_name: string;
  bio: string;
  avatar_url?: string;
  city: string;
  rate_min: number | null;
  rate_max: number | null;
  currency: string;
  contact_email: string;
  contact_phone: string;
  social_links: Record<SocialKey, string>;
  updated_at?: string;
}

@Component({
  selector: 'app-cabinet-page',
  standalone: true,
  imports: [
    FormsModule,
    NzSpinModule,
    NzButtonModule,
    NzInputModule,
    NzTagModule,
    NzAlertModule,
    NzSelectModule,
    NzIconModule,
    DragDropModule,
    AppHeaderComponent,
    ProfileShareComponent,
    CompletenessIndicatorComponent,
  ],
  templateUrl: './cabinet.page.html',
  styleUrl: './cabinet.page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CabinetPage implements OnInit, OnDestroy {
  private readonly meRepo = inject(MeRepository);

  private readonly auth = inject(AuthSessionStore);

  private readonly router = inject(Router);

  private readonly categoryApi = inject(CategoryApi);

  private readonly productionApi = inject(ProductionApi);

  private readonly msg = inject(NzMessageService);

  private readonly modalService = inject(NzModalService);

  private readonly sessionStorage = window.sessionStorage;

  public readonly checkLoading = signal(false);

  public readonly user = signal<MeUser | null>(null);

  public readonly profile = signal<MeProfile | null>(null);

  public readonly shareRef = viewChild<ProfileShareComponent>('share');

  public onUsernameChange(newUsername: string): void {
    // newUsername уже trimmed+lowercased в child. "" = сброс.
    const ref = this.shareRef();
    this.meRepo
      .patchProfileFull({
        username: newUsername,
        updated_at: this.profile()?.updated_at,
      })
      .subscribe({
        next: (p) => {
          this.applyProfile(p);
          ref?.onSaveSuccess();
          this.msg.success(newUsername ? 'Username сохранён' : 'Username сброшен');
        },
        error: (err) => {
          const msg = err?.error?.message || 'Не удалось сохранить username';
          ref?.onSaveError(msg);
          // Дублируем тостом, чтобы юзер заметил ошибку даже если форма
          // ниже скролла (на узких экранах). 409 username_taken — самый
          // частый кейс, должен явно сигналиться.
          this.msg.error(msg, { nzDuration: 5000 });
        },
      });
  }

  public readonly categories = signal<Category[]>([]);

  // Рекомендованные навыки текущей подборки категорий (kind != platform).
  // Перезагружается на каждый toggle категории, потому что фронт обращается
  // к /skills?category=... и получает уже отфильтрованный набор из БД.
  public readonly recommendedSkills = signal<Skill[]>([]);

  // Платформы — общий фасет, не зависит от выбранных категорий.
  // Грузится один раз в loadAll() через /skills?kind=platform.
  public readonly platformSkills = signal<Skill[]>([]);

  public readonly portfolio = signal<PortfolioItem[]>([]);

  public readonly loading = signal(true);

  public readonly saving = signal(false);

  public readonly avatarUploading = signal(false);

  // localAvatarUrl — blob:URL свежевыбранного файла. На iOS Safari
  // загрузка JPG через src= рисуется построчно («шторка»). Локальный
  // blob: рисуется мгновенно — нет CDN, нет CORS, нет progressive draw.
  // Очищаем после ngOnDestroy или когда form.avatar_url приходит из БД.
  public readonly localAvatarUrl = signal<string | null>(null);

  // displayedAvatarUrl — что показывать в <img>. Приоритет локальному
  // blob (свежий выбор) → потом form.avatar_url из БД/PATCH-ответа.
  public readonly displayedAvatarUrl = computed(
    () => this.localAvatarUrl() || this.form.avatar_url,
  );

  public readonly avatarBusy = computed(() => this.avatarUploading());

  public readonly error = signal('');

  public readonly check = signal<ProfileCheckResult | null>(null);

  public readonly selectedCategories = signal<Set<string>>(new Set());

  public readonly primaryCategory = signal('');

  public readonly selectedSkills = signal<Set<string>>(new Set());

  // Список активных продакшенов для селектора «Где вы работаете».
  public readonly productions = signal<Production[]>([]);

  // Выбор: '' — не выбрано, 'freelance' — фриланс, иначе UUID продакшена.
  // Двусторонняя ngModel-привязка идёт через productionSelectedValue ниже.
  public readonly productionSelected = signal<string>('');

  public get productionSelectedValue(): string {
    return this.productionSelected();
  }

  public set productionSelectedValue(v: string) {
    this.productionSelected.set(v);
  }

  public form: ProfileForm = {
    display_name: '',
    bio: '',
    city: '',
    rate_min: null,
    rate_max: null,
    currency: 'RUB',
    contact_email: '',
    contact_phone: '',
    social_links: emptySocialLinks(),
  };

  // Список соцсетей для шаблона (рендер inputs).
  public readonly socialNetworks = SOCIAL_NETWORKS;

  public readonly tools = computed(() => this.recommendedSkills());

  public readonly platforms = computed(() => this.platformSkills());

  public readonly categoryGroups = computed(() => groupCategoriesByType(this.categories()));

  public ngOnInit(): void {
    if (!this.auth.isLoggedIn()) {
      this.router.navigate(['/']);
      return;
    }
    this.loadAll();
  }

  public ngOnDestroy(): void {
    // Освобождаем blob: URL свежевыбранного аватара чтобы не утекала память.
    const local = this.localAvatarUrl();
    if (local) URL.revokeObjectURL(local);
  }

  public logout(): void {
    this.auth.clear();
    this.router.navigate(['/']);
  }

  public categoryTitle(code: string): string {
    return this.categories().find((c) => c.code === code)?.title ?? code;
  }

  public toggleCategory(code: string): void {
    const next = new Set(this.selectedCategories());
    if (next.has(code)) {
      next.delete(code);
      if (this.primaryCategory() === code) {
        this.primaryCategory.set([...next][0] ?? '');
      }
    } else {
      next.add(code);
      if (!this.primaryCategory()) this.primaryCategory.set(code);
    }
    this.selectedCategories.set(next);
    this.refreshRecommendedSkills();
  }

  public setPrimary(code: string, ev: Event): void {
    ev.stopPropagation();
    const next = new Set(this.selectedCategories());
    const added = !next.has(code);
    next.add(code);
    this.selectedCategories.set(next);
    this.primaryCategory.set(code);
    if (added) this.refreshRecommendedSkills();
  }

  public toggleSkill(id: string): void {
    const next = new Set(this.selectedSkills());
    if (next.has(id)) next.delete(id);
    else next.add(id);
    this.selectedSkills.set(next);
  }

  public save(publish = false): void {
    this.error.set('');
    this.check.set(null);
    if (!this.form.display_name.trim()) {
      this.error.set('Имя/название не может быть пустым.');
      return;
    }
    if (
      this.form.rate_min != null &&
      this.form.rate_max != null &&
      this.form.rate_min > this.form.rate_max
    ) {
      this.error.set('Ставка «от» больше «до».');
      return;
    }
    if (publish && !this.selectedCategories().size) {
      this.error.set('Выберите хотя бы одну категорию перед публикацией.');
      return;
    }
    if (publish && !this.form.bio.trim()) {
      this.error.set('Заполните описание перед публикацией.');
      return;
    }
    this.saving.set(true);

    // Одной транзакцией: профиль + категории + навыки под одним updated_at.
    // Раньше шла цепочка из трёх запросов и updated_at между ними расходился —
    // второй/третий получали 409. См. backend handler PatchFull.
    const codes = [...this.selectedCategories()];
    const payload: MeProfileFullPatch = {
      display_name: this.form.display_name.trim(),
      bio: this.form.bio,
      avatar_url: this.form.avatar_url?.trim() ?? '',
      city: this.form.city.trim(),
      currency: (this.form.currency || 'RUB').trim().toUpperCase(),
      contact_email: this.form.contact_email.trim(),
      contact_phone: this.form.contact_phone.trim(),
      rate_min: this.form.rate_min ?? null,
      rate_max: this.form.rate_max ?? null,
      skills: { skill_ids: [...this.selectedSkills()] },
      social_links: this.form.social_links,
      updated_at: this.sessionStorage.getItem('updated_at') ?? undefined,
    };
    if (codes.length) {
      payload.categories = { codes, primary: this.primaryCategory() || codes[0] };
    }
    // Где работает: 'freelance' → is_freelance=true; UUID → production_id=UUID;
    // '' → снять оба (production_id='', is_freelance=false). Бэк сам разруливает
    // XOR-инвариант: при включении одного снимет другой.
    const ps = this.productionSelected();
    if (ps === 'freelance') {
      payload.is_freelance = true;
    } else if (ps === '') {
      payload.production_id = '';
      payload.is_freelance = false;
    } else {
      payload.production_id = ps;
    }

    this.meRepo
      .patchProfileFull(payload)
      .pipe(
        catchError((err) => {
          this.failSave(err);
          return EMPTY;
        }),
      )
      .subscribe((p) => {
        this.setUpdatedAt(p.updated_at);
        if (publish) {
          this.publish();
        } else {
          this.doneSave(p, 'Сохранено');
        }
      });
  }

  public unpublish(): void {
    this.saving.set(true);
    this.meRepo
      .unpublishProfile()
      .pipe(
        catchError((err) => {
          this.failSave(err);
          return EMPTY;
        }),
      )
      .subscribe((p) => {
        this.applyProfile(p);
        this.saving.set(false);
        this.msg.success('Профиль снят с публикации');
      });
  }

  public runCheck(): void {
    this.checkLoading.set(true);
    this.check.set(null);
    this.error.set('');
    if (!this.form.display_name.trim() && !this.form.bio.trim()) {
      this.error.set('Заполните имя или описание перед проверкой.');
      return;
    }
    this.meRepo
      .checkProfile(this.form.display_name, this.form.bio)
      .pipe(
        catchError((err) => {
          this.error.set(apiErrorMessage(err.error, 'Проверка временно недоступна'));
          this.check.set(null);
          this.checkLoading.set(false);
          return of<ProfileCheckResult | null>(null);
        }),
      )
      .subscribe((result) => {
        if (result) {
          this.msg.success('Проверка профиля завершена');
          this.error.set('');
          this.check.set(result);
          this.checkLoading.set(false);
        }
      });
  }

  public async uploadAvatar(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const original = input.files?.[0];
    // input.value уже сбрасывается на (click) до открытия picker'а
    // (см. cabinet.page.html). Не сбрасываем тут — иначе change event
    // вернёт пустой files на следующем рендере у некоторых iOS-версий.
    if (!original) return;
    // Принимаем любой image/* (включая HEIC от iPhone-камеры) — canvas
    // в resizeImageToBlob сам декодирует то что браузер умеет открыть.
    // Если браузер не может декодить — fileToHtmlImage кинет ошибку,
    // поймаем в catch и покажем toast.
    if (!original.type.startsWith('image/')) {
      this.msg.error('Аватар: ожидается картинка (jpg, png, webp, heic)', {
        nzDuration: 6000,
      });
      return;
    }
    // Sanity-cap 50 MB — больше браузер не вытянет decode без OOM на
    // мобильном (Safari kills tab). С iPhone-фото 8-15 MB это запас 3×.
    if (original.size > 50 * 1024 * 1024) {
      const sizeMB = (original.size / (1024 * 1024)).toFixed(1);
      this.msg.error(`Файл ${sizeMB} МБ слишком большой даже для resize. Максимум 50 МБ.`, {
        nzDuration: 6000,
      });
      return;
    }

    this.avatarUploading.set(true);
    try {
      // Resize в canvas: гарантированно baseline (не progressive) JPEG,
      // фиксированные 512×512 — для круглого аватара 160px этого с запасом
      // на retina. iOS Safari больше не рисует частями (canvas decodes
      // полностью), и upload меньше в ~10×.
      const { file: resized } = await resizeImageToBlob(original, 512, 0.9);

      // blob: URL РЕСАЙЗНУТОГО canvas-вывода — отрисуется мгновенно из ОЗУ.
      const prevLocal = this.localAvatarUrl();
      this.localAvatarUrl.set(URL.createObjectURL(resized));
      if (prevLocal) URL.revokeObjectURL(prevLocal);

      const publicURL = await this.uploadViaPresign(
        () => this.meRepo.presignAvatarUpload(resized),
        resized,
      );
      this.form.avatar_url = publicURL;
      this.msg.success('Аватар загружен. Нажмите «Сохранить», чтобы применить.');
    } catch (err) {
      this.error.set(`Не удалось загрузить аватар: ${(err as Error).message}`);
      const local = this.localAvatarUrl();
      if (local) URL.revokeObjectURL(local);
      this.localAvatarUrl.set(null);
    } finally {
      this.avatarUploading.set(false);
    }
  }

  public clearAvatar(): void {
    this.form.avatar_url = '';
    const local = this.localAvatarUrl();
    if (local) URL.revokeObjectURL(local);
    this.localAvatarUrl.set(null);
    this.msg.info('Аватар будет очищен после сохранения профиля.');
  }

  public readonly portfolioDragOver = signal(false);

  // Inline-edit для title/description портфолио-айтема (video или photoset).
  // editingItemId — id текущего открытого редактора (null = ничего не редактируется).
  public readonly editingItemId = signal<string | null>(null);
  public editTitle = '';
  public editDescription = '';
  public readonly savingMeta = signal(false);

  public readonly maxPhotosPerSet = 10;

  // Скрытый input для append-фото — на него триггерим клик когда юзер жмёт
  // «+ Фото» в карточке photo-set'а. Запоминаем target item для onChange.
  public readonly appendPhotosInput = viewChild<ElementRef<HTMLInputElement>>('appendPhotosInput');
  private appendTargetItemId: string | null = null;

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
    const item = this.portfolio().find((p) => p.id === itemId);
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
      this.portfolio.update((items) =>
        items.map((p) =>
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
      this.refreshProfileUpdatedAt();
      this.msg.success(`Добавлено ${refs.length} фото`);
    } catch (err) {
      this.msg.error(apiErrorMessage((err as { error?: ApiErrorBody })?.error ?? null, 'Не удалось добавить фото'));
    } finally {
      this.savingMeta.set(false);
    }
  }

  public onReorderImages(item: PortfolioItem, ev: CdkDragDrop<unknown>): void {
    if (!item.images || ev.previousIndex === ev.currentIndex) return;
    const reordered = [...item.images];
    moveItemInArray(reordered, ev.previousIndex, ev.currentIndex);
    // Оптимистично применяем на фронте — пользователь видит мгновенный отклик.
    this.portfolio.update((items) =>
      items.map((p) =>
        p.id === item.id
          ? { ...p, images: reordered, thumbnail_url: reordered[0].image_url }
          : p,
      ),
    );
    this.meRepo.reorderPortfolioImages(item.id, reordered.map((i) => i.id)).subscribe({
      next: (res) => {
        // Бэк может перенумеровать sort_order и обновляет parent.updated_at —
        // синхронизируем и то, и другое (иначе следующий PATCH meta = 409).
        this.portfolio.update((items) =>
          items.map((p) =>
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
        this.refreshProfileUpdatedAt();
      },
      error: (err) => {
        // Откатываем — перезагружаем с сервера.
        this.loadPortfolio();
        this.msg.error(apiErrorMessage(err?.error ?? null, 'Не удалось изменить порядок'));
      },
    });
  }

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
          const m = apiErrorMessage(err.error, 'Не удалось сохранить');
          this.msg.error(m);
          return EMPTY;
        }),
      )
      .subscribe((updated) => {
        this.savingMeta.set(false);
        this.portfolio.update((items) =>
          items.map((p) => (p.id === updated.id ? { ...p, ...updated } : p)),
        );
        this.editingItemId.set(null);
        this.refreshProfileUpdatedAt();
        this.msg.success('Сохранено');
      });
  }

  public onPortfolioDragEnter(ev: DragEvent): void {
    if (!ev.dataTransfer?.types.includes('Files')) return;
    ev.preventDefault();
    this.portfolioDragOver.set(true);
  }

  public onPortfolioDragOver(ev: DragEvent): void {
    if (!ev.dataTransfer?.types.includes('Files')) return;
    ev.preventDefault();
    ev.dataTransfer.dropEffect = 'copy';
  }

  public onPortfolioDragLeave(ev: DragEvent): void {
    // dragleave срабатывает и на детях — игнорим если ушли на ребёнка
    const related = ev.relatedTarget as Node | null;
    if (related && (ev.currentTarget as HTMLElement).contains(related)) return;
    this.portfolioDragOver.set(false);
  }

  public onPortfolioDrop(ev: DragEvent): void {
    ev.preventDefault();
    this.portfolioDragOver.set(false);
    this.routeFiles(Array.from(ev.dataTransfer?.files ?? []));
  }

  public onPortfolioPicked(ev: Event): void {
    const input = ev.target as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    input.value = '';
    this.routeFiles(files);
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
        this.msg.warning('Видео загружаются по одному. Открываю первое — остальные загрузите следующими.');
      }
      this.openUploadDialog(videos[0]);
      return;
    }
    if (images.length > 0 && videos.length > 0) {
      this.msg.warning('Видео и фото нельзя в одну загрузку. Открыл фото-кейс — видео загрузите отдельно.');
      this.openPhotoSetDialog(images);
      return;
    }
    // Ничего не распознано
    this.msg.error('Поддерживаются только видео (MP4/MOV) и фото (JPG/PNG/WEBP/HEIC).');
  }

  public openUploadDialog(initialFile?: File): void {
    const ref = this.modalService.create<
      PortfolioUploadDialog,
      PortfolioUploadDialogData,
      PortfolioUploadDialogResult | null
    >({
      nzTitle: 'Новое видео в портфолио',
      nzContent: PortfolioUploadDialog,
      nzFooter: null,
      nzWidth: 560,
      nzClassName: 'portfolio-upload-modal',
      nzMaskClosable: false,
      nzData: {
        categories: this.categories(),
        primaryCategory: this.primaryCategory(),
        selectedCategoryCodes: [...this.selectedCategories()],
        initialFile,
      },
    });
    ref.afterClose.subscribe((res: PortfolioUploadDialogResult | null | undefined) => {
      if (res?.created) {
        this.loadPortfolio();
        this.refreshProfileUpdatedAt();
        this.msg.success('Видео добавлено');
      }
    });
  }

  public openPhotoSetDialog(initialFiles?: File[]): void {
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
        selectedCategoryCodes: [...this.selectedCategories()],
        initialFiles,
      },
    });
    ref.afterClose.subscribe((res: PhotoSetUploadDialogResult | null | undefined) => {
      if (res?.created) {
        this.loadPortfolio();
        this.refreshProfileUpdatedAt();
        this.msg.success('Фото-кейс добавлен');
      }
    });
  }

  // refreshProfileUpdatedAt — синхронизирует optimistic-lock snapshot после
  // любой portfolio-write операции. Бэкенд бампает specialist_profiles.updated_at
  // двумя путями:
  //   1. LockProfileForUpdateInTx — берётся при create video / create photoset /
  //      delete photo (для concurrency-safety). UPDATE specialist_profiles
  //      SET updated_at = now() — всегда бампает.
  //   2. BumpModerationToPendingIfApprovedInTx — если спец approved, любой
  //      portfolio-change переводит в pending_review (+ бампает updated_at).
  // Без рефреша следующий PATCH /me/profile получит 409 conflict.
  private refreshProfileUpdatedAt(): void {
    this.meRepo.getProfile().subscribe({
      next: (p) => {
        this.setUpdatedAt(p.updated_at);
        // Обновляем ТАКЖЕ signal profile.updated_at — иначе onUsernameChange /
        // saveProfile берут устаревший snapshot из this.profile() и получают
        // 409 «объект изменён». applyProfile() не используем чтобы не
        // перезатереть form-state (юзер мог что-то печатать в полях).
        this.profile.update((cur) =>
          cur ? { ...cur, updated_at: p.updated_at } : cur,
        );
      },
      error: () => {
        // Не критично: на следующем save юзер получит 409 и страница
        // подскажет обновить — лучше чем ронять текущий happy-path action.
      },
    });
  }

  public deletePortfolio(id: string): void {
    this.meRepo
      .deletePortfolio(id)
      .pipe(
        catchError((err) => {
          this.error.set(apiErrorMessage(err.error, 'Не удалось удалить видео'));
          return EMPTY;
        }),
      )
      .subscribe(() => {
        this.portfolio.update((items) => items.filter((p) => p.id !== id));
        this.refreshProfileUpdatedAt();
        this.msg.success('Видео удалено');
      });
  }

  // Удалить одно фото из photo-set'а. Бэк автоматически снесёт сам сет,
  // если в нём не осталось фото — поэтому удаляем из portfolio локально
  // либо обновляем images-массив.
  public deletePhotoSetImage(item: PortfolioItem, imageId: string): void {
    this.meRepo
      .deletePortfolioImage(imageId)
      .pipe(
        catchError((err) => {
          this.error.set(apiErrorMessage(err.error, 'Не удалось удалить фото'));
          return EMPTY;
        }),
      )
      .subscribe(() => {
        const remaining = (item.images ?? []).filter((i) => i.id !== imageId);
        if (remaining.length === 0) {
          this.portfolio.update((items) => items.filter((p) => p.id !== item.id));
          this.refreshProfileUpdatedAt();
          this.msg.success('Сет удалён — последнее фото было удалено');
          return;
        }
        // Полностью перезагружаем portfolio: backend обновляет
        // portfolio_items.updated_at при изменении cover'а, без перезагрузки
        // фронт держал бы stale snapshot → следующий PATCH meta = 409.
        // loadPortfolio() возвращает свежие updated_at для всех items.
        this.loadPortfolio();
        this.refreshProfileUpdatedAt();
        this.msg.success('Фото удалено');
      });
  }

  public togglePortfolioCategory(item: PortfolioItem, code: string): void {
    const next = new Set(item.category_codes ?? []);
    if (next.has(code)) next.delete(code);
    else next.add(code);
    this.meRepo
      .updatePortfolioCategories(item.id, [...next])
      .pipe(
        catchError((err) => {
          this.error.set(apiErrorMessage(err.error, 'Не удалось обновить категории видео'));
          return EMPTY;
        }),
      )
      .subscribe((updated) => {
        this.portfolio.update((items) => items.map((p) => (p.id === updated.id ? updated : p)));
        // SetPortfolioCategories на бэке проходит через
        // BumpModerationToPendingIfApprovedInTx (для approved-спецов) — это
        // меняет specialist_profiles.updated_at. Без refresh следующий
        // PATCH /me/profile получит 409.
        this.refreshProfileUpdatedAt();
      });
  }

  private loadAll(): void {
    this.loading.set(true);
    this.meRepo
      .getUser()
      .pipe(
        catchError(() => {
          this.auth.clear();
          void this.router.navigate(['/']);
          return EMPTY;
        }),
      )
      .subscribe((u) => {
        this.user.set(u);
      });
    this.categoryApi.list().subscribe((items) => this.categories.set(items));
    this.productionApi.listActive().subscribe((r) => this.productions.set(r.items));
    // Платформы (reels/tiktok/...) — отдельный фасет, общий для всех категорий,
    // подгружаем один раз. Остальные навыки — динамически на refreshRecommendedSkills().
    this.categoryApi.skills({ kind: 'platform' }).subscribe((items) => {
      this.platformSkills.set(items);
    });
    this.meRepo
      .getProfile()
      .pipe(
        // 15 сек на ответ — если backend / прокси завис, лучше показать
        // ошибку чем держать вечный спиннер. Загрузка профиля в норме <500ms.
        timeout({
          each: 15000,
          with: () =>
            throwError(
              () => ({ error: { message: 'Сервер не отвечает 15 секунд. Обновите страницу.' } }),
            ),
        }),
        catchError((err) => {
          this.error.set(apiErrorMessage(err?.error, 'Не удалось загрузить профиль'));
          return EMPTY;
        }),
        // finalize гарантирует loading=false ВНЕ зависимости от success/error/
        // timeout — раньше флаг сбрасывался только в success branch + catch,
        // в каком-то edge-case (например interceptor застрял в refresh-loop'е
        // и подавил emission) loading оставался true → вечный спиннер.
        finalize(() => this.loading.set(false)),
      )
      .subscribe((p) => {
        this.setUpdatedAt(p.updated_at);
        this.applyProfile(p);
        this.loadPortfolio();
      });
  }

  private setUpdatedAt(updated_at: string): void {
    this.sessionStorage.setItem('updated_at', updated_at);
  }

  private loadPortfolio(): void {
    this.meRepo
      .listPortfolio()
      .pipe(
        catchError(() => {
          this.portfolio.set([]);
          return EMPTY;
        }),
      )
      .subscribe((items) => this.portfolio.set(items));
  }

  private applyProfile(p: MeProfile): void {
    this.profile.set(p);
    // Синхронизируем sessionStorage updated_at — иначе после publish/
    // unpublish следующий save получит 409 «объект был изменён другим
    // запросом», потому что бэк bump'нул updated_at внутри publish-tx.
    if (p.updated_at) this.setUpdatedAt(p.updated_at);
    const social = emptySocialLinks();
    if (p.social_links) {
      for (const n of SOCIAL_NETWORKS) {
        social[n.key] = (p.social_links[n.key] as string | undefined) ?? '';
      }
    }
    this.form = {
      display_name: p.display_name ?? '',
      bio: p.bio ?? '',
      avatar_url: p.avatar_url ?? '',
      city: p.city ?? '',
      rate_min: p.rate_min ?? null,
      rate_max: p.rate_max ?? null,
      currency: p.currency || 'RUB',
      contact_email: p.contact_email ?? '',
      contact_phone: p.contact_phone ?? '',
      social_links: social,
    };
    this.selectedCategories.set(new Set(p.categories ?? []));
    this.primaryCategory.set(p.primary_category || p.categories?.[0] || '');
    this.selectedSkills.set(new Set(p.skill_ids ?? []));
    this.productionSelected.set(p.is_freelance ? 'freelance' : (p.production_id ?? ''));
    this.refreshRecommendedSkills();
  }

  // Подгружает рекомендованные навыки под выбранные категории и подрезает
  // selectedSkills: если убрали категорию, навыки которой больше нигде не
  // встречаются, они исчезнут из чипов — нельзя оставлять их выбранными
  // в сохраняемом наборе. Платформы не трогаем — они всегда разрешены.
  private refreshRecommendedSkills(): void {
    const codes = [...this.selectedCategories()];
    if (codes.length === 0) {
      this.recommendedSkills.set([]);
      this.pruneSelectedSkills(new Set());
      return;
    }
    forkJoin(codes.map((c) => this.categoryApi.skills({ category: c }))).subscribe((lists) => {
      const seen = new Set<string>();
      const merged: Skill[] = [];
      for (const list of lists) {
        for (const s of list) {
          if (!seen.has(s.id)) {
            seen.add(s.id);
            merged.push(s);
          }
        }
      }
      this.recommendedSkills.set(merged);
      this.pruneSelectedSkills(new Set(merged.map((s) => s.id)));
    });
  }

  private pruneSelectedSkills(allowedRecommendedIds: Set<string>): void {
    const platformIds = new Set(this.platformSkills().map((s) => s.id));
    const current = this.selectedSkills();
    const next = new Set<string>();
    for (const id of current) {
      if (allowedRecommendedIds.has(id) || platformIds.has(id)) next.add(id);
    }
    if (next.size !== current.size) this.selectedSkills.set(next);
  }


  private publish(): void {
    this.meRepo
      .publishProfile()
      .pipe(
        catchError((err) => {
          if (isEmailUnverifiedError(err)) {
            this.saving.set(false);
            openEmailUnverifiedDialog(this.modalService);
            return EMPTY;
          }
          if (err.status === 422 && err.error?.check) {
            this.check.set(err.error.check);
          }
          this.failSave(err);
          return EMPTY;
        }),
      )
      .subscribe((p) => this.doneSave(p, 'Профиль опубликован'));
  }

  private doneSave(p: MeProfile, message: string): void {
    this.applyProfile(p);
    this.saving.set(false);
    this.msg.success(message);
  }

  private failSave(err: { error?: ApiErrorBody | null }): void {
    this.saving.set(false);
    const message = apiErrorMessage(err.error ?? null, 'Не удалось сохранить');
    this.error.set(message);
    this.msg.error(message);
  }

  private uploadViaPresign(
    presign: () => Observable<UploadURLResponse>,
    file: File,
    onProgress?: (percent: number) => void,
  ): Promise<string> {
    return firstValueFrom(presign()).then((res) =>
      putFileToPresignedUrl(res.upload_url, file, onProgress).then(() => res.public_url),
    );
  }
}

