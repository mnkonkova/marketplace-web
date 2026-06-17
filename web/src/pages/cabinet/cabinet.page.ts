import {
  ChangeDetectionStrategy,
  Component,
  OnDestroy,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
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
import { EMPTY, Observable, firstValueFrom, forkJoin, of } from 'rxjs';
import { catchError } from 'rxjs/operators';
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
    AppHeaderComponent,
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
  };

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

  // openAvatarPicker — создаём fresh <input type=file> на каждый клик и
  // программно открываем picker. iOS Safari иногда не шлёт change event
  // если использовать один и тот же input повторно (внутренний state
  // помнит previous selection). Свежий input = чистый state, любой выбор
  // триггерит change.
  public openAvatarPicker(): void {
    if (this.avatarUploading()) return;
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/jpeg,image/png,image/webp';
    input.style.position = 'fixed';
    input.style.opacity = '0';
    input.style.pointerEvents = 'none';
    input.addEventListener('change', (ev) => {
      void this.uploadAvatar(ev);
      // Удаляем input после consumption — память не накапливается даже
      // при сотне попыток.
      input.remove();
    });
    // Если юзер закрыл picker без выбора — change не сработает, чистим
    // на focus-back на window. Не гарантированно но лучше чем утечка.
    const cleanup = (): void => {
      setTimeout(() => input.remove(), 1000);
      window.removeEventListener('focus', cleanup);
    };
    window.addEventListener('focus', cleanup, { once: true });
    document.body.appendChild(input);
    input.click();
  }

  public async uploadAvatar(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const original = input.files?.[0];
    if (!original) return;
    if (!/^image\/(jpeg|png|webp)$/.test(original.type)) {
      this.error.set('Аватар: поддерживаем jpg, png или webp.');
      return;
    }
    if (original.size > 5 * 1024 * 1024) {
      this.error.set('Аватар больше 5 МБ.');
      return;
    }

    this.avatarUploading.set(true);
    try {
      // Resize в canvas: гарантированно baseline (не progressive) JPEG,
      // фиксированные 512×512 — для круглого аватара 160px этого с запасом
      // на retina. iOS Safari больше не рисует частями (canvas decodes
      // полностью), и upload меньше в ~10×.
      const resized = await resizeImageToBlob(original, 512, 0.9);

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
    const f = ev.dataTransfer?.files?.[0];
    if (f) this.openUploadDialog(f);
  }

  public onPortfolioPicked(ev: Event): void {
    const input = ev.target as HTMLInputElement;
    const f = input.files?.[0];
    input.value = '';
    if (f) this.openUploadDialog(f);
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
        // Бэк бампит specialist_profiles.updated_at внутри AddPortfolioVideo
        // (через LockProfileForUpdateInTx — лок на лимит 20 видео).
        // Без обновления sessionStorage следующий main-save получит 409.
        this.meRepo.getProfile().subscribe({
          next: (p) => this.setUpdatedAt(p.updated_at),
          error: () => {},
        });
        this.msg.success('Видео добавлено');
      }
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
        this.msg.success('Видео удалено');
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
        catchError((err) => {
          this.loading.set(false);
          this.error.set(apiErrorMessage(err.error, 'Не удалось загрузить профиль'));
          return EMPTY;
        }),
      )
      .subscribe((p) => {
        console.log(p);
        this.setUpdatedAt(p.updated_at);
        this.applyProfile(p);
        this.loadPortfolio();
        this.loading.set(false);
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

// resizeImageToBlob — даун-скейлит картинку в canvas и пересохраняет
// как baseline JPEG с правильным EXIF-rotation. Решает:
//   • iOS Safari progressive-JPG «шторка» (canvas всегда выдаёт baseline);
//   • HEIC/огромные фото с камеры — десериализуются canvas'ом в обычный JPEG;
//   • EXIF rotation iPhone-камеры — createImageBitmap респектит ориентацию
//     (без этого drawImage рисует неповёрнутые байты → серые поля);
//   • upload в 5-10× меньше — мобильный канал тянет быстрее.
async function resizeImageToBlob(file: File, maxSize: number, quality: number): Promise<File> {
  const source = await loadImageRespectingExif(file);
  const sourceW = 'naturalWidth' in source ? source.naturalWidth : source.width;
  const sourceH = 'naturalHeight' in source ? source.naturalHeight : source.height;
  const { width, height } = scaleToFit(sourceW, sourceH, maxSize);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas_unsupported');
  // Прозрачность не нужна, заполним фоном чтобы серых полей не было
  // даже если EXIF неожиданно не учёлся.
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(source as CanvasImageSource, 0, 0, width, height);
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error('canvas_toblob_null'));
          return;
        }
        const baseName = file.name.replace(/\.\w+$/, '') || 'avatar';
        resolve(new File([blob], `${baseName}.jpg`, { type: 'image/jpeg' }));
      },
      'image/jpeg',
      quality,
    );
  });
}

// createImageBitmap с imageOrientation='from-image' — это РАБОЧИЙ способ
// учесть EXIF rotation в canvas. <img> + drawImage не учитывают EXIF в
// canvas — рисуется raw-битмап → перевёрнутый, плюс серые поля по краям.
async function loadImageRespectingExif(file: File): Promise<ImageBitmap | HTMLImageElement> {
  // Path A: createImageBitmap с EXIF — Chrome 79+, Safari 15+, Firefox 113+.
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch {
      // Fallthrough: некоторые мобильные Safari < 15 не поддерживают второй
      // аргумент с опциями — переходим на HTMLImage fallback.
    }
  }
  // Path B: <img> fallback. Современные Safari/Chrome автоматически
  // применяют EXIF при отрисовке <img> в canvas через drawImage. Старые
  // не применяют — но на них и проблемы изначально не было.
  return fileToHtmlImage(file);
}

function fileToHtmlImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = (): void => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = (): void => {
      URL.revokeObjectURL(url);
      reject(new Error('image_decode'));
    };
    img.src = url;
  });
}

function scaleToFit(w: number, h: number, maxSize: number): { width: number; height: number } {
  if (w <= maxSize && h <= maxSize) return { width: w, height: h };
  if (w >= h) return { width: maxSize, height: Math.round((h / w) * maxSize) };
  return { width: Math.round((w / h) * maxSize), height: maxSize };
}
