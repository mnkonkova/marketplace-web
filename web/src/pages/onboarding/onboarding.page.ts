import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { EMPTY, catchError, finalize, firstValueFrom } from 'rxjs';
import { NzInputModule } from 'ng-zorro-antd/input';
import { NzSelectModule } from 'ng-zorro-antd/select';
import { NzMessageService } from 'ng-zorro-antd/message';
import { NzModalService } from 'ng-zorro-antd/modal';

import { CategoryApi } from '@entities/category/api/category.api';
import { Category, Skill } from '@entities/category/model/category.types';
import { MeRepository } from '@entities/me/repository/me.repository';
import { ProfileForm, emptyProfileForm } from '@entities/me/model/profile-form';
import { PortfolioItem } from '@entities/specialist/model/specialist.types';
import { ProductionApi } from '@entities/production/api/production.api';
import { Production } from '@entities/production/model/production.types';
import { AuthSessionStore } from '@entities/auth/model/auth-session.store';
import { AuthDialogComponent } from '@features/auth/ui/auth.dialog';
import { openClientRegister } from '@features/client-register/open-client-register';
import { ApiErrorBody, apiErrorMessage } from '@shared/api/api-error';
import { putFileToPresignedUrl } from '@entities/me/repository/me-upload';
import { resizeImageToBlob } from '@shared/image/resize';
import { groupCategoriesByType } from '@shared/lib/category-groups';
import { isTouchDevice } from '@shared/lib/touch';
import { validateRate } from '@shared/lib/rate-validation';
import { AvatarPickerComponent } from '@shared/ui/avatar-picker/avatar-picker.component';
import { RolePickerComponent } from '@shared/ui/role-picker/role-picker.component';
import { SkillPickerComponent } from '@shared/ui/skill-picker/skill-picker.component';
import { OptionSheetComponent, SheetOption } from '@shared/ui/option-sheet/option-sheet.component';
import {
  PortfolioUploadDialog,
  PortfolioUploadDialogData,
  PortfolioUploadDialogResult,
} from '@features/portfolio-upload/portfolio-upload.dialog';

/** Шаги мастера специалиста. Роль выбирается до них, на нулевом экране. */
const STEPS = [
  { id: 'account', label: 'Аккаунт', skippable: false },
  { id: 'who', label: 'Кто вы', skippable: false },
  { id: 'skills', label: 'Навыки', skippable: false },
  // Работа обязательна: без единого ролика специалиста не показывает ни
  // лента, ни каталог — публиковать такой профиль бессмысленно.
  { id: 'work', label: 'Первая работа', skippable: false },
  { id: 'about', label: 'О себе', skippable: true },
  // Ник — последнее перед финалом: к этому моменту человек уже видел своё
  // имя и роли, и придумать короткий адрес ему проще, чем на старте.
  { id: 'link', label: 'Ссылка', skippable: true },
  { id: 'done', label: 'Почта', skippable: false },
] as const;

type StepId = (typeof STEPS)[number]['id'];

/** 409 приходит и на занятый ник, и на устаревший updated_at — различаем. */
function isUsernameTaken(err: { error?: ApiErrorBody | null }): boolean {
  return err?.error?.error === 'username_taken';
}

/**
 * Онбординг специалиста.
 *
 * Собирает ровно те же данные, что и кабинет, поэтому не рисует свои поля, а
 * вставляет готовые компоненты: аватар, карточки ролей, чипы навыков,
 * загрузчик работы. Свой здесь только каркас — выбор роли, шаги и навигация.
 *
 * Сохранение идёт тем же PATCH /me/profile, что и в кабинете, одной
 * транзакцией (профиль + категории + навыки). Параллельного стора нет: после
 * финиша /me открывается уже заполненным.
 */
@Component({
  selector: 'app-onboarding-page',
  standalone: true,
  imports: [
    FormsModule,
    NzInputModule,
    NzSelectModule,
    AvatarPickerComponent,
    OptionSheetComponent,
    RolePickerComponent,
    SkillPickerComponent,
  ],
  templateUrl: './onboarding.page.html',
  styleUrl: './onboarding.page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OnboardingPage {
  private readonly meRepo = inject(MeRepository);

  private readonly categoryApi = inject(CategoryApi);

  private readonly productionApi = inject(ProductionApi);

  private readonly modal = inject(NzModalService);

  private readonly msg = inject(NzMessageService);

  private readonly router = inject(Router);

  private readonly route = inject(ActivatedRoute);

  private readonly auth = inject(AuthSessionStore);

  private readonly sessionStorage = window.sessionStorage;

  public readonly steps = STEPS;

  /** null — ещё на экране выбора роли. */
  public readonly stepIndex = signal<number | null>(null);

  public readonly saving = signal(false);

  public readonly error = signal('');

  public readonly form = signal<ProfileForm>(emptyProfileForm());

  public readonly avatarUploading = signal(false);

  // Где человек работает: '' — не выбрано, 'freelance' — фрилансер, иначе id
  // продакшена. Спрашивается здесь, а не только в кабинете: без этого поля
  // профиль считается незаполненным, и человек узнавал об этом уже после
  // мастера — на экране «почему меня не публикуют».
  //
  // Продакшены заводит администрация, поэтому здесь только выбор из готового
  // списка: своей студии в мастере не создать, и обещать этого не надо.

  public readonly productionSelected = signal('');

  public readonly productionSheet = signal(false);

  /** Тач-экран: списки открываем шторкой, а не выпадающим меню. */
  public readonly isTouch = signal(isTouchDevice());

  public readonly productionOptions = computed<SheetOption[]>(() => [
    { value: 'freelance', label: 'Фрилансер' },
    ...this.productions().map((pr) => ({ value: pr.id, label: pr.name })),
  ]);

  public productionLabel(): string {
    return (
      this.productionOptions().find((o) => o.value === this.productionSelected())?.label ??
      'Выберите вариант'
    );
  }

  /** blob-ссылка на ужатый файл: показываем ещё до ответа S3. */
  public readonly localAvatarUrl = signal<string | null>(null);

  /** Фото, выбранное до регистрации: уедет, как только появится аккаунт. */
  private readonly pendingAvatar = signal<File | null>(null);

  // Учётные данные держим до шага «Кто вы»: регистрация требует имя, а его
  // спрашивают там. Отдельным окном форму больше не показываем — она часть
  // мастера, первым шагом.
  public readonly email = signal('');

  public readonly password = signal('');

  /** Публичный ник для адреса /specialist/<ник>. Пусто — останется UUID. */
  public readonly username = signal('');

  /** Показать кнопку «Войти» рядом с ошибкой: адрес уже занят. */
  public readonly emailTaken = signal(false);

  public readonly categories = signal<Category[]>([]);

  public readonly productions = signal<Production[]>([]);

  public readonly tools = signal<Skill[]>([]);

  public readonly platforms = signal<Skill[]>([]);

  public readonly selectedCategories = signal<Set<string>>(new Set());

  public readonly primaryCategory = signal('');

  public readonly selectedSkills = signal<Set<string>>(new Set());

  public readonly portfolio = signal<PortfolioItem[]>([]);

  public readonly categoryGroups = computed(() => groupCategoriesByType(this.categories()));

  public readonly step = computed<StepId | null>(() => {
    const i = this.stepIndex();
    return i === null ? null : STEPS[i].id;
  });

  public readonly bioLength = computed(() => this.form().bio.trim().length);

  /** Первый шаг требует имя и хотя бы одну роль — без них профиля нет. */
  public readonly canGoNext = computed(() => {
    if (this.step() === 'account') {
      // Формат письма проверяем мягко, длину пароля не дублируем: минимум
      // знает бэкенд и вернёт понятную ошибку.
      return /.+@.+\..+/.test(this.email().trim()) && this.password().length > 0;
    }
    if (this.step() === 'work') return this.portfolio().length > 0;
    if (this.step() === 'link') {
      const u = this.username().trim();
      // Пустой ник допустим — шаг пропускаемый; непустой должен подойти
      // бэкенду, иначе он вернёт 400 уже на сохранении.
      return u === '' || /^[a-z0-9_-]{3,30}$/.test(u);
    }
    if (this.step() !== 'who') return true;
    return this.form().display_name.trim().length > 0 && this.selectedCategories().size > 0;
  });

  public constructor() {
    // Роль слушаем, а не читаем один раз: со страницы /start можно попасть
    // на /start?role=specialist (ссылка «я специалист» в окне заказчика), и
    // компонент при этом не пересоздаётся — snapshot остался бы пустым.
    this.route.queryParamMap.pipe(takeUntilDestroyed()).subscribe((params) => {
      const role = params.get('role');
      if (role === 'client') {
        this.goClient();
        return;
      }
      if (role === 'specialist' && this.stepIndex() === null) this.startSpecialist();
    });

    this.categoryApi.list().subscribe((items) => this.categories.set(items));
    this.productionApi.listActive().subscribe((r) => this.productions.set(r.items));
    this.categoryApi.skills({ kind: 'platform' }).subscribe((items) => this.platforms.set(items));
  }

  /**
   * Правка одного поля формы. Отдельный метод, потому что в шаблонах Angular
   * нет spread-синтаксиса: `{ ...form(), city: $event }` не компилируется.
   */
  public setField<K extends keyof ProfileForm>(key: K, value: ProfileForm[K]): void {
    this.form.update((f) => ({ ...f, [key]: value }));
  }

  /** Уже есть аккаунт — обычный вход, дальше мастер продолжится с шага 2. */
  public openLogin(): void {
    const ref = this.modal.create({
      nzContent: AuthDialogComponent,
      nzFooter: null,
      nzWidth: 'min(420px, 92vw)',
      nzData: { initialTab: 0 },
    });
    ref.afterClose.subscribe(() => {
      if (this.auth.isLoggedIn()) this.stepIndex.set(1);
    });
  }

  public setEmail(value: string): void {
    this.email.set(value);
    if (this.emailTaken()) {
      this.emailTaken.set(false);
      this.error.set('');
    }
  }

  public startSpecialist(): void {
    this.stepIndex.set(0);
  }

  /**
   * Аккаунт создаём молча на переходе с шага «Кто вы»: почта и пароль уже
   * введены первым шагом, имя — вторым, а это всё, что нужно бэкенду.
   * Отдельное окно регистрации поверх мастера сбивало с толку — человек уже
   * заполнял анкету и не понимал, откуда взялась форма.
   */
  private ensureAccount(done: () => void): void {
    if (this.auth.isLoggedIn()) {
      done();
      return;
    }
    this.saving.set(true);
    this.auth
      .register({
        email: this.email().trim(),
        password: this.password(),
        display_name: this.form().display_name.trim(),
        kind: 'specialist',
        source: 'onboarding',
      })
      .pipe(
        catchError((err: { error?: ApiErrorBody | null }) => {
          const text = apiErrorMessage(err?.error ?? null, 'Не удалось создать аккаунт');
          // Занятый email — самый частый случай, и «уже зарегистрирован» не
          // подсказывает, что делать. Занятость видна только здесь: ручки
          // «свободен ли адрес» в API нет, поэтому предлагаем выход прямо в
          // тексте ошибки.
          this.emailTaken.set(/уже зарегистрир|already exists/i.test(text));
          this.error.set(
            this.emailTaken()
              ? 'На этот email уже есть аккаунт. Войдите в него или укажите другой адрес.'
              : text,
          );
          this.stepIndex.set(0);
          return EMPTY;
        }),
        finalize(() => this.saving.set(false)),
      )
      .subscribe(() => {
        this.flushPendingAvatar();
        done();
      });
  }

  public goClient(): void {
    // Заказчику мастер не нужен: окно регистрации и сразу поиск. Уже
    // вошедшего просто пускаем в каталог.
    if (this.auth.isLoggedIn()) {
      void this.router.navigate(['/search']);
      return;
    }
    openClientRegister(this.modal);
  }

  public back(): void {
    const i = this.stepIndex();
    if (i === null) return;
    if (i === 0) this.stepIndex.set(null);
    else this.stepIndex.set(i - 1);
  }

  public next(): void {
    const i = this.stepIndex();
    if (i === null) return;
    // Профиль сохраняем на переходе с первого шага: дальше уже нужны
    // категории на сервере — от них зависят рекомендованные навыки и теги
    // работы. Тот же PATCH, что жмёт «Сохранить» в кабинете.
    if (STEPS[i].id === 'who') {
      this.saveProfile(() => this.stepIndex.set(i + 1));
      return;
    }
    if (STEPS[i].id === 'skills' || STEPS[i].id === 'about' || STEPS[i].id === 'link') {
      this.saveProfile(() => this.stepIndex.set(i + 1));
      return;
    }
    this.stepIndex.set(Math.min(i + 1, STEPS.length - 1));
  }

  public skip(): void {
    const i = this.stepIndex();
    if (i !== null) this.stepIndex.set(Math.min(i + 1, STEPS.length - 1));
  }

  public toggleCategory(code: string): void {
    const next = new Set(this.selectedCategories());
    if (next.has(code)) {
      next.delete(code);
      if (this.primaryCategory() === code) this.primaryCategory.set([...next][0] ?? '');
    } else {
      next.add(code);
      if (!this.primaryCategory()) this.primaryCategory.set(code);
    }
    this.selectedCategories.set(next);
    this.refreshTools();
  }

  public setPrimary(code: string): void {
    if (!this.selectedCategories().has(code)) return;
    this.primaryCategory.set(code);
  }

  public toggleSkill(id: string): void {
    const next = new Set(this.selectedSkills());
    if (next.has(id)) next.delete(id);
    else next.add(id);
    this.selectedSkills.set(next);
  }

  public onAvatarPicked(ev: Event): void {
    const file = (ev.target as HTMLInputElement).files?.[0];
    if (!file) return;
    void this.uploadAvatar(file);
  }

  /**
   * Загрузка аватара повторяет проверенный путь кабинета, а не сокращённый:
   * фото с телефона приходит на 8-15 МБ и в HEIC, и без ресайза загрузка
   * либо висит минутами, либо роняет вкладку Safari на decode.
   *
   * Порядок: проверить тип и размер → ужать канвасом до 512px → показать
   * локальный blob сразу → отдать в S3 по presigned-ссылке.
   */
  private async uploadAvatar(original: File): Promise<void> {
    if (!original.type.startsWith('image/')) {
      this.msg.error('Аватар: ожидается картинка (jpg, png, webp, heic)', { nzDuration: 6000 });
      return;
    }
    if (original.size > 50 * 1024 * 1024) {
      const sizeMB = (original.size / (1024 * 1024)).toFixed(1);
      this.msg.error(`Файл ${sizeMB} МБ слишком большой. Максимум 50 МБ.`, { nzDuration: 6000 });
      return;
    }

    this.avatarUploading.set(true);
    try {
      const { file: resized } = await resizeImageToBlob(original, 512, 0.9);

      // Локальный предпросмотр из ОЗУ — картинка появляется сразу, не
      // дожидаясь ответа S3. Прошлый blob освобождаем, иначе течёт память.
      const prev = this.localAvatarUrl();
      this.localAvatarUrl.set(URL.createObjectURL(resized));
      if (prev) URL.revokeObjectURL(prev);

      // До регистрации отправлять некуда: presign требует аккаунт. Файл
      // ждёт в памяти и уедет сразу после создания аккаунта — просить
      // регистрацию прямо здесь нельзя, имя ещё не введено, и попытка
      // выбрасывала человека обратно на первый шаг.
      if (!this.auth.isLoggedIn()) {
        this.pendingAvatar.set(resized);
        return;
      }
      await this.sendAvatar(resized);
    } catch (err) {
      this.error.set(`Не удалось загрузить фото: ${(err as Error).message}`);
      const local = this.localAvatarUrl();
      if (local) URL.revokeObjectURL(local);
      this.localAvatarUrl.set(null);
    } finally {
      this.avatarUploading.set(false);
    }
  }

  /** Отправка ужатого файла в S3 по presigned-ссылке. */
  private async sendAvatar(file: File): Promise<void> {
    const presign = await firstValueFrom(this.meRepo.presignAvatarUpload(file));
    await putFileToPresignedUrl(presign.upload_url, file);
    this.setField('avatar_url', presign.public_url);
  }

  /** Догружает фото, выбранное до регистрации. */
  private flushPendingAvatar(): void {
    const file = this.pendingAvatar();
    if (!file) return;
    this.pendingAvatar.set(null);
    this.avatarUploading.set(true);
    void this.sendAvatar(file)
      .catch((err) => this.error.set(`Не удалось загрузить фото: ${(err as Error).message}`))
      .finally(() => this.avatarUploading.set(false));
  }

  public clearAvatar(): void {
    this.setField('avatar_url', '');
    this.pendingAvatar.set(null);
    const local = this.localAvatarUrl();
    if (local) URL.revokeObjectURL(local);
    this.localAvatarUrl.set(null);
  }

  /** Нажали «Загрузить работу».
   *
   *  На телефоне открываем медиатеку сразу, без промежуточного окна: там
   *  первым экраном диалога всё равно стоит «выберите видео», то есть человек
   *  делает два тапа вместо одного и первый — в пустоту. Форму с названием
   *  показываем уже поверх выбранного файла.
   *
   *  Клик по input'у должен случиться в том же жесте, что и нажатие кнопки:
   *  Safari разрешает открывать выбор файла только по живому действию
   *  человека, и отложенный вызов молча ничего не сделает. Поэтому у
   *  незалогиненных остаётся прежний путь — сперва аккаунт, потом диалог:
   *  жест к этому моменту всё равно потерян.
   */
  public pickWork(input: HTMLInputElement): void {
    if (!this.auth.isLoggedIn()) {
      this.ensureAccount(() => this.addWork());
      return;
    }
    if (isTouchDevice()) input.click();
    else this.addWork();
  }

  public onWorkPicked(ev: Event): void {
    const input = ev.target as HTMLInputElement;
    const file = input.files?.[0];
    // Сбрасываем значение сразу: иначе повторный выбор того же файла не
    // считается изменением и change не приходит вовсе.
    input.value = '';
    if (file) this.addWork(file);
  }

  /** Загрузчик работы — тот же диалог, что в кабинете. */
  public addWork(initialFile?: File): void {
    if (!this.auth.isLoggedIn()) {
      this.ensureAccount(() => this.addWork());
      return;
    }
    const ref = this.modal.create<
      PortfolioUploadDialog,
      PortfolioUploadDialogData,
      PortfolioUploadDialogResult | null
    >({
      nzContent: PortfolioUploadDialog,
      nzFooter: null,
      nzWidth: 560,
      nzClassName: 'portfolio-upload-modal',
      nzMaskClosable: false,
      nzData: {
        categories: this.categories(),
        selectedCategoryCodes: [...this.selectedCategories()],
        primaryCategory: this.primaryCategory(),
        initialFile,
      },
    });
    // Диалог сам создаёт работу через API, поэтому список просто
    // перечитываем — как это делает кабинет.
    ref.afterClose.subscribe((res) => {
      if (res?.created) this.loadPortfolio();
    });
  }

  public finish(): void {
    this.saveProfile(() => void this.router.navigate(['/me']));
  }

  public readonly resendState = signal<'idle' | 'sent' | 'error'>('idle');

  /** Письмо могло не дойти — даём отправить ещё раз, не выходя из мастера. */
  public resendVerification(): void {
    this.auth
      .resendVerification()
      .pipe(
        catchError(() => {
          this.resendState.set('error');
          return EMPTY;
        }),
      )
      .subscribe(() => this.resendState.set('sent'));
  }

  public goToCabinet(): void {
    void this.router.navigate(['/me']);
  }

  /**
   * Тот же вызов, которым сохраняется кабинет: профиль, категории и навыки
   * уходят одной транзакцией под общим updated_at.
   */
  private saveProfile(done: () => void, retried = false): void {
    if (!this.auth.isLoggedIn()) {
      this.ensureAccount(() => this.saveProfile(done));
      return;
    }
    const f = this.form();
    const rate = validateRate(f.rate_min, f.rate_max, f.currency);
    if (rate.error) {
      this.error.set(rate.error);
      return;
    }
    this.error.set('');
    this.saving.set(true);
    const codes = [...this.selectedCategories()];
    this.meRepo
      .patchProfileFull({
        display_name: f.display_name.trim(),
        bio: f.bio,
        avatar_url: f.avatar_url?.trim() ?? '',
        city: f.city.trim(),
        currency: (f.currency || 'RUB').trim().toUpperCase(),
        contact_email: f.contact_email.trim(),
        contact_phone: f.contact_phone.trim(),
        rate_min: rate.min,
        rate_max: rate.max,
        categories: codes.length
          ? { codes, primary: this.primaryCategory() || codes[0] }
          : undefined,
        skills: { skill_ids: [...this.selectedSkills()] },
        social_links: f.social_links,
        // undefined = не трогать: пустую строку бэкенд понял бы как сброс.
        username: this.username().trim() || undefined,
        // Где работает: 'freelance' → is_freelance, иначе id продакшена.
        // XOR между ними держит бэкенд — включая одно, снимает другое.
        ...(this.productionSelected() === 'freelance'
          ? { is_freelance: true }
          : this.productionSelected()
            ? { production_id: this.productionSelected() }
            : {}),
      })
      .pipe(
        catchError((err: { status?: number; error?: ApiErrorBody | null }) => {
          // 409 бывает двух видов: занятый username и устаревший updated_at.
          // Второй в мастере штатен — добавление работы бампает профиль, —
          // поэтому один раз молча перечитываем и повторяем сохранение.
          // Занятый ник: сохранение атомарное, поэтому вместе с ним не
          // сохранилось ничего — ни фото, ни описание. Повторяем БЕЗ ника,
          // чтобы работа человека не пропала, и возвращаем его на шаг
          // «Ссылка» с внятным объяснением, что менять надо одно слово.
          if (isUsernameTaken(err) && this.username()) {
            this.username.set('');
            this.saveProfile(() => {
              this.error.set(
                'Такой ник уже занят. Остальное сохранено — придумайте другой и нажмите «Далее».',
              );
              this.stepIndex.set(STEPS.findIndex((st) => st.id === 'link'));
            }, true);
            return EMPTY;
          }
          if (err?.status === 409 && !retried) {
            this.meRepo.getProfile().subscribe({
              next: (p) => {
                this.sessionStorage.setItem('updated_at', p.updated_at);
                this.saveProfile(done, true);
              },
              error: () => this.error.set('Профиль изменился в другой вкладке. Обновите страницу.'),
            });
            return EMPTY;
          }
          this.error.set(apiErrorMessage(err?.error ?? null, 'Не удалось сохранить'));
          return EMPTY;
        }),
        finalize(() => this.saving.set(false)),
      )
      .subscribe(() => {
        this.refreshTools();
        done();
      });
  }

  private loadPortfolio(): void {
    this.meRepo
      .listPortfolio()
      .pipe(catchError(() => EMPTY))
      .subscribe((items) => this.portfolio.set(items));
  }

  /** Инструменты подтягиваются под выбранные роли — как в кабинете. */
  private refreshTools(): void {
    const codes = [...this.selectedCategories()];
    if (!codes.length) {
      this.tools.set([]);
      return;
    }
    this.categoryApi.skills({ category: codes[0] }).subscribe((items) => this.tools.set(items));
  }
}
