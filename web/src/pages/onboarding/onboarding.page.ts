import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { EMPTY, catchError, finalize } from 'rxjs';
import { NzInputModule } from 'ng-zorro-antd/input';
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
import { apiErrorMessage } from '@shared/api/api-error';
import { groupCategoriesByType } from '@shared/lib/category-groups';
import { validateRate } from '@shared/lib/rate-validation';
import { AvatarPickerComponent } from '@shared/ui/avatar-picker/avatar-picker.component';
import { RolePickerComponent } from '@shared/ui/role-picker/role-picker.component';
import { SkillPickerComponent } from '@shared/ui/skill-picker/skill-picker.component';
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
  { id: 'done', label: 'Почта', skippable: false },
] as const;

type StepId = (typeof STEPS)[number]['id'];

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
    AvatarPickerComponent,
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

  public readonly steps = STEPS;

  /** null — ещё на экране выбора роли. */
  public readonly stepIndex = signal<number | null>(null);

  public readonly saving = signal(false);

  public readonly error = signal('');

  public readonly form = signal<ProfileForm>(emptyProfileForm());

  public readonly avatarUploading = signal(false);

  // Учётные данные держим до шага «Кто вы»: регистрация требует имя, а его
  // спрашивают там. Отдельным окном форму больше не показываем — она часть
  // мастера, первым шагом.
  public readonly email = signal('');

  public readonly password = signal('');

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
    if (this.step() !== 'who') return true;
    return this.form().display_name.trim().length > 0 && this.selectedCategories().size > 0;
  });

  public constructor() {
    // С лендинга приходят с уже выбранной ролью — развилку показывать
    // незачем. Заказчику мастер не нужен вовсе: ему в каталог.
    const role = this.route.snapshot.queryParamMap.get('role');
    if (role === 'client') {
      this.goClient();
      return;
    }
    if (role === 'specialist') this.startSpecialist();

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
        catchError((err) => {
          this.error.set(apiErrorMessage(err?.error, 'Не удалось создать аккаунт'));
          // Возвращаем на шаг с почтой: обычно занят email или слаб пароль.
          this.stepIndex.set(0);
          return EMPTY;
        }),
        finalize(() => this.saving.set(false)),
      )
      .subscribe(() => done());
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
    if (STEPS[i].id === 'skills' || STEPS[i].id === 'about') {
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
    // Файл уходит в наш S3 через presign — без аккаунта его некуда класть.
    if (!this.auth.isLoggedIn()) {
      this.ensureAccount(() => this.uploadAvatar(file));
      return;
    }
    this.uploadAvatar(file);
  }

  private uploadAvatar(file: File): void {
    this.avatarUploading.set(true);
    this.meRepo
      .presignAvatarUpload(file)
      .pipe(
        catchError((err) => {
          this.msg.error(apiErrorMessage(err?.error, 'Не удалось загрузить фото'));
          return EMPTY;
        }),
        finalize(() => this.avatarUploading.set(false)),
      )
      .subscribe(async (presign) => {
        await fetch(presign.upload_url, { method: 'PUT', body: file });
        this.form.update((f) => ({ ...f, avatar_url: presign.public_url }));
      });
  }

  public clearAvatar(): void {
    this.form.update((f) => ({ ...f, avatar_url: '' }));
  }

  /** Загрузчик работы — тот же диалог, что в кабинете. */
  public addWork(): void {
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
  private saveProfile(done: () => void): void {
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
      })
      .pipe(
        catchError((err) => {
          this.error.set(apiErrorMessage(err?.error, 'Не удалось сохранить'));
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
