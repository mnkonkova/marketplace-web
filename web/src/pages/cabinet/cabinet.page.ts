import {
  ChangeDetectionStrategy,
  Component,
  HostListener,
  OnDestroy,
  OnInit,
  computed,
  inject,
  signal,
  viewChild,
  DestroyRef,
} from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { NzSpinModule } from 'ng-zorro-antd/spin';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzAlertModule } from 'ng-zorro-antd/alert';
import { NzBadgeModule } from 'ng-zorro-antd/badge';
import { NzTabsModule } from 'ng-zorro-antd/tabs';
import { NzMessageService } from 'ng-zorro-antd/message';
import { NzModalService } from 'ng-zorro-antd/modal';
import {
  EMPTY,
  Observable,
  firstValueFrom,
  forkJoin,
  of,
  throwError,
  Subject,
  switchMap,
  map,
} from 'rxjs';
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
import { ProfileForm, emptyProfileForm, emptySocialLinks } from '@entities/me/model/profile-form';
import { CategoryApi } from '@entities/category/api/category.api';
import { Category, Skill } from '@entities/category/model/category.types';
import { ProductionApi } from '@entities/production/api/production.api';
import { Production } from '@entities/production/model/production.types';
import { PortfolioItem } from '@entities/specialist/model/specialist.types';
import { ApiErrorBody, apiErrorMessage } from '@shared/api/api-error';
import { resizeImageToBlob } from '@shared/image/resize';
import { groupCategoriesByType } from '@shared/lib/category-groups';
import {
  PROFILE_TAB_IDS,
  ProfileTabId,
  completenessChecks,
  missingWeightByTab,
} from '@shared/lib/profile-completeness';
import { specialistHandle } from '@shared/lib/specialist-link';
import { validateRate } from '@shared/lib/rate-validation';
import { AppHeaderComponent } from '@widgets/app-header/app-header.component';
import {
  isEmailUnverifiedError,
  openEmailUnverifiedDialog,
} from '@features/auth/lib/open-email-unverified-dialog';
import { SOCIAL_NETWORKS } from '@shared/lib/social-links';
import { CompletenessIndicatorComponent } from '@widgets/completeness-indicator/completeness-indicator.component';
import { ProfileBasicComponent } from '@features/profile-basic/profile-basic.component';
import { ProfileContactsComponent } from '@features/profile-contacts/profile-contacts.component';
import { ProfilePortfolioComponent } from '@features/profile-portfolio/profile-portfolio.component';
import { ProfilePublishComponent } from '@features/profile-publish/profile-publish.component';
import { ProfileSkillsComponent } from '@features/profile-skills/profile-skills.component';

interface TabDef {
  id: ProfileTabId;
  label: string;
}

const TABS: TabDef[] = [
  { id: 'basic', label: 'Основное' },
  { id: 'skills', label: 'Навыки' },
  { id: 'portfolio', label: 'Портфолио' },
  { id: 'contacts', label: 'Контакты' },
  { id: 'publish', label: 'Публикация' },
];

/**
 * Редактор профиля специалиста `/me`.
 *
 * Раньше был одной вертикальной простынёй; сейчас — пять вкладок
 * (`features/profile-*`) под общей шапкой (баннер модерации + прогресс
 * заполненности) и общей sticky-панелью действий.
 *
 * Состояние формы намеренно осталось на странице: вкладки её только
 * отображают. Так переключение табов ничего не теряет, сохранение
 * остаётся одним PATCH'ем, и не появляется второго стора.
 */
@Component({
  selector: 'app-cabinet-page',
  standalone: true,
  imports: [
    NzSpinModule,
    NzButtonModule,
    NzAlertModule,
    NzBadgeModule,
    NzTabsModule,
    AppHeaderComponent,
    CompletenessIndicatorComponent,
    ProfileBasicComponent,
    ProfileSkillsComponent,
    ProfilePortfolioComponent,
    ProfileContactsComponent,
    ProfilePublishComponent,
  ],
  templateUrl: './cabinet.page.html',
  styleUrl: './cabinet.page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CabinetPage implements OnInit, OnDestroy {
  private readonly meRepo = inject(MeRepository);

  private readonly auth = inject(AuthSessionStore);

  private readonly router = inject(Router);

  private readonly route = inject(ActivatedRoute);

  private readonly categoryApi = inject(CategoryApi);

  private readonly productionApi = inject(ProductionApi);

  private readonly msg = inject(NzMessageService);

  private readonly modalService = inject(NzModalService);

  private readonly sessionStorage = window.sessionStorage;

  public readonly tabs = TABS;

  /**
   * Активная вкладка живёт в query-параметре: ссылка `/me?tab=portfolio`
   * и перезагрузка страницы должны открывать то же место.
   */
  private readonly queryParams = toSignal(this.route.queryParamMap, { initialValue: null });

  public readonly tab = computed<ProfileTabId>(() => {
    const raw = this.queryParams()?.get('tab') ?? '';
    return (PROFILE_TAB_IDS as string[]).includes(raw) ? (raw as ProfileTabId) : 'basic';
  });

  public readonly tabIndex = computed(() => {
    const i = TABS.findIndex((t) => t.id === this.tab());
    return i < 0 ? 0 : i;
  });

  public readonly checkLoading = signal(false);

  public readonly user = signal<MeUser | null>(null);

  public readonly profile = signal<MeProfile | null>(null);

  public readonly publishRef = viewChild<ProfilePublishComponent>('publishTab');

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
  // Аватар, загруженный в S3, но ещё не сохранённый в профиле: между этими
  // двумя моментами человек жмёт другие кнопки, и ответы сервера не должны
  // его затирать. Снимается вместе с успешным сохранением формы.
  private pendingAvatar: string | null = null;

  // localAvatarUrl — blob:URL свежевыбранного файла. На iOS Safari
  // загрузка JPG через src= рисуется построчно («шторка»). Локальный
  // blob: рисуется мгновенно — нет CDN, нет CORS, нет progressive draw.
  // Очищаем после ngOnDestroy или когда form.avatar_url приходит из БД.
  public readonly localAvatarUrl = signal<string | null>(null);

  // Ре-рендер аватара по сигналу: form — обычный объект, за его полями
  // сигналы не следят, поэтому после uploadAvatar дёргаем этот счётчик.
  private readonly avatarVersion = signal(0);

  // displayedAvatarUrl — что показывать в <img>. Приоритет локальному
  // blob (свежий выбор) → потом form.avatar_url из БД/PATCH-ответа.
  public readonly displayedAvatarUrl = computed(() => {
    this.avatarVersion();
    return this.localAvatarUrl() || this.form.avatar_url;
  });

  public readonly error = signal('');

  public readonly check = signal<ProfileCheckResult | null>(null);

  public readonly selectedCategories = signal<Set<string>>(new Set());

  public readonly primaryCategory = signal('');

  public readonly selectedSkills = signal<Set<string>>(new Set());

  // Список активных продакшенов для селектора «Где вы работаете».
  public readonly productions = signal<Production[]>([]);

  // Выбор: '' — не выбрано, 'freelance' — фриланс, иначе UUID продакшена.
  public readonly productionSelected = signal<string>('');

  public form: ProfileForm = emptyProfileForm();

  public readonly tools = computed(() => this.recommendedSkills());

  public readonly platforms = computed(() => this.platformSkills());

  public readonly categoryGroups = computed(() => groupCategoriesByType(this.categories()));

  /**
   * Сколько процентов «недобрано» на каждой вкладке. Из этого рисуется
   * точка-бейдж на заголовке таба: список «Что добавить (+%)» из шапки
   * иначе не подсказывает, куда идти.
   */
  public readonly missingByTab = computed(() =>
    missingWeightByTab(completenessChecks(this.profile(), this.portfolio())),
  );

  public readonly publicUrl = computed(() => {
    const p = this.profile();
    if (!p) return '';
    return `/specialist/${specialistHandle({ username: p.username, user_id: p.user_id })}`;
  });

  /** Снимок сохранённого состояния — для «есть несохранённые изменения». */
  private savedSnapshot = '';

  private readonly destroyRef = inject(DestroyRef);

  public ngOnInit(): void {
    this.subscribeSkillsStream();
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

  // === Вкладки ===

  public onTabIndexChange(index: number): void {
    const next = TABS[index]?.id ?? 'basic';
    if (next === this.tab()) return;
    // replaceUrl: вкладки — не история навигации, «назад» должен уводить
    // со страницы, а не перебирать пять табов.
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { tab: next === 'basic' ? null : next },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  public tabMissing(id: ProfileTabId): boolean {
    return this.missingByTab()[id] > 0;
  }

  // === Несохранённые изменения ===

  private snapshot(): string {
    return JSON.stringify({
      form: this.form,
      categories: [...this.selectedCategories()],
      primary: this.primaryCategory(),
      skills: [...this.selectedSkills()].sort(),
      production: this.productionSelected(),
    });
  }

  /** true — в форме есть правки, которых нет на сервере. */
  public hasUnsavedChanges(): boolean {
    if (!this.profile()) return false;
    return this.savedSnapshot !== '' && this.snapshot() !== this.savedSnapshot;
  }

  @HostListener('window:beforeunload', ['$event'])
  public onBeforeUnload(ev: BeforeUnloadEvent): void {
    if (!this.hasUnsavedChanges()) return;
    ev.preventDefault();
    // Chrome требует непустой returnValue, текст всё равно свой показать нельзя.
    ev.returnValue = '';
  }

  public logout(): void {
    this.auth.clear();
    this.router.navigate(['/']);
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

  public setPrimary(code: string): void {
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

  public onUsernameChange(newUsername: string): void {
    // newUsername уже trimmed+lowercased в child. "" = сброс.
    const ref = this.publishRef();
    this.meRepo
      .patchProfileFull({
        username: newUsername,
        updated_at: this.profile()?.updated_at,
      })
      .subscribe({
        next: (p) => {
          // Только username и updated_at, БЕЗ applyProfile: тот перезаписывает
          // форму целиком ответом сервера. Username сохраняется отдельной
          // кнопкой, посреди правки остальной формы, — и на этом месте у юзера
          // пропадал только что загруженный аватар. Пропадал молча: превью
          // рисуется из blob'а в памяти, картинка на экране оставалась, а в
          // форме уже лежало старое значение с сервера, и «Сохранить»
          // отправляло его обратно. Ровно так же терялись бы недописанные
          // «о себе» и город.
          this.profile.update((cur) =>
            cur ? { ...cur, username: p.username, updated_at: p.updated_at } : p,
          );
          if (p.updated_at) this.setUpdatedAt(p.updated_at);
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

  // === Портфолио (список принадлежит странице, операции — вкладке) ===

  public onPortfolioItemsChange(items: PortfolioItem[]): void {
    this.portfolio.set(items);
  }

  public onPortfolioReload(): void {
    this.loadPortfolio();
  }

  public save(publish = false): void {
    this.error.set('');
    this.check.set(null);
    if (!this.form.display_name.trim()) {
      this.error.set('Имя/название не может быть пустым.');
      this.goToTab('basic');
      return;
    }
    const rate = validateRate(this.form.rate_min, this.form.rate_max, this.form.currency);
    if (rate.error) {
      this.error.set(rate.error);
      this.goToTab('basic');
      return;
    }
    if (publish && !this.selectedCategories().size) {
      this.error.set('Выберите хотя бы одну категорию перед публикацией.');
      this.goToTab('skills');
      return;
    }
    if (publish && !this.form.bio.trim()) {
      this.error.set('Заполните описание перед публикацией.');
      this.goToTab('basic');
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
      // Нормализованные значения: 0 и пустое уезжают как null, иначе на
      // публичной выходило «от 0 ₽».
      rate_min: rate.min,
      rate_max: rate.max,
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
    // (см. profile-basic.component.html). Не сбрасываем тут — иначе change
    // event вернёт пустой files на следующем рендере у некоторых iOS-версий.
    if (!original) return;
    // Принимаем любой image/* (включая HEIC от iPhone-камеры) — canvas
    // в resizeImageToBlob сам декодирует то что браузер умеет открыть.
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
      this.pendingAvatar = publicURL;
      this.avatarVersion.update((v) => v + 1);
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
    this.pendingAvatar = ''; // снятие — тоже правка, и её тоже беречь
    const local = this.localAvatarUrl();
    if (local) URL.revokeObjectURL(local);
    this.localAvatarUrl.set(null);
    this.avatarVersion.update((v) => v + 1);
    this.msg.info('Аватар будет очищен после сохранения профиля.');
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
  public refreshProfileUpdatedAt(): void {
    this.meRepo.getProfile().subscribe({
      next: (p) => {
        this.setUpdatedAt(p.updated_at);
        // Обновляем ТАКЖЕ signal profile.updated_at — иначе onUsernameChange /
        // save берут устаревший snapshot из this.profile() и получают
        // 409 «объект изменён». applyProfile() не используем чтобы не
        // перезатереть form-state (юзер мог что-то печатать в полях).
        this.profile.update((cur) => (cur ? { ...cur, updated_at: p.updated_at } : cur));
      },
      error: () => {
        // Не критично: на следующем save юзер получит 409 и страница
        // подскажет обновить — лучше чем ронять текущий happy-path action.
      },
    });
  }

  private goToTab(id: ProfileTabId): void {
    const index = TABS.findIndex((t) => t.id === id);
    if (index >= 0) this.onTabIndexChange(index);
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
            throwError(() => ({
              error: { message: 'Сервер не отвечает 15 секунд. Обновите страницу.' },
            })),
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
    // Загруженный, но ещё не сохранённый аватар не отдаём серверному ответу:
    // он про него не знает, а человек его уже видит на экране. Иначе форма
    // получает старое значение, «Сохранить» отправляет его обратно, и фото
    // исчезает — при том, что превью всё это время показывало новое.
    const pending = this.pendingAvatar;
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
      avatar_url: pending ?? p.avatar_url ?? '',
      city: p.city ?? '',
      rate_min: p.rate_min ?? null,
      rate_max: p.rate_max ?? null,
      currency: p.currency || 'RUB',
      contact_email: p.contact_email ?? '',
      contact_phone: p.contact_phone ?? '',
      social_links: social,
    };
    this.avatarVersion.update((v) => v + 1);
    this.selectedCategories.set(new Set(p.categories ?? []));
    this.primaryCategory.set(p.primary_category || p.categories?.[0] || '');
    this.selectedSkills.set(new Set(p.skill_ids ?? []));
    this.productionSelected.set(p.is_freelance ? 'freelance' : (p.production_id ?? ''));
    this.savedSnapshot = this.snapshot();
    this.refreshRecommendedSkills(true);
  }

  // Подгружает рекомендованные навыки под выбранные категории и подрезает
  // selectedSkills: если убрали категорию, навыки которой больше нигде не
  // встречаются, они исчезнут из чипов — нельзя оставлять их выбранными
  // в сохраняемом наборе. Платформы не трогаем — они всегда разрешены.
  //
  // rebaseline=true — вызов сразу после загрузки профиля: подрезка навыков
  // не должна выглядеть как «пользователь что-то поменял».
  /** Один запрос на все выбранные роли; предыдущий отменяется. */
  private subscribeSkillsStream(): void {
    this.skillsRequest$
      .pipe(
        switchMap(({ codes, rebaseline }) =>
          this.categoryApi
            .skills({ categories: codes })
            .pipe(map((list) => ({ lists: [list], rebaseline }))),
        ),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe(({ lists, rebaseline }) => this.applyRecommendedSkills(lists, rebaseline));
  }

  private refreshRecommendedSkills(rebaseline = false): void {
    const codes = [...this.selectedCategories()];
    if (codes.length === 0) {
      this.recommendedSkills.set([]);
      this.pruneSelectedSkills(new Set());
      if (rebaseline) this.savedSnapshot = this.snapshot();
      return;
    }
    // switchMap, а не подписка на каждый клик: ответы не отменялись и
    // приходили не по порядку. Медленный ответ от прежнего набора категорий
    // приходил последним, и pruneSelectedSkills вычищал навыки, законные для
    // текущего набора — потеря уезжала прямо в сохранение.
    this.skillsRequest$.next({ codes, rebaseline });
  }

  /** Поток запросов навыков: последний отменяет предыдущий. */
  private readonly skillsRequest$ = new Subject<{ codes: string[]; rebaseline: boolean }>();

  private applyRecommendedSkills(lists: Skill[][], rebaseline: boolean): void {
    {
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
      if (rebaseline) this.savedSnapshot = this.snapshot();
    }
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
    // Сохранение прошло — аватар больше не «в подвешенном состоянии»,
    // дальше правдой служит ответ сервера.
    this.pendingAvatar = null;
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
