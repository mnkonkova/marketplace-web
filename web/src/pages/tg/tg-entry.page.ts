import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';

import { AuthSessionStore } from '@entities/auth/model/auth-session.store';
import { parseApiError } from '@shared/api/api-error';
import {
  initData,
  isTelegramWebApp,
  loadTelegramScript,
  tgHapticResult,
  tgReady,
} from '@shared/lib/telegram-webapp';

/**
 * Вход из мини-аппа Telegram.
 *
 * Экран без шапки и без меню: человек уже внутри Telegram, и второе
 * меню поверх его собственного читается как чужая страница. Задача
 * здесь одна — понять, кто пришёл, и увести в его кабинет.
 *
 * Развилка «у меня уже есть аккаунт / я новый» показывается только
 * тогда, когда телеграм нам незнаком. Молча заводить второй аккаунт
 * нельзя: у человека уже может быть наш — с проектами, историей и
 * деньгами, — и пустой дубль оставил бы его без всего этого.
 */
@Component({
  selector: 'app-tg-entry-page',
  standalone: true,
  imports: [CommonModule, FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="tg-app">
      <div class="card">
        @switch (state()) {
          @case ('loading') {
            <p class="muted">Входим…</p>
          }
          @case ('outside') {
            <!-- Открыли в обычном браузере: подписи нет, и проверить
                 человека нечем. Врать «что-то пошло не так» незачем —
                 всё в порядке, просто это другой вход. -->
            <h1>Это вход из Telegram</h1>
            <p class="muted">
              Страница открывается внутри бота. В браузере войдите обычным способом — почтой и
              паролем.
            </p>
            <a class="btn primary" href="/login">Войти на сайте</a>
          }
          @case ('fork') {
            <h1>Первый раз здесь?</h1>
            <p class="muted">
              Мы не нашли аккаунт, привязанный к этому телеграму. Если он у вас уже есть — войдите,
              и телеграм привяжется к нему. Заводить второй не нужно: проекты и история остались бы
              в первом.
            </p>
            <div class="acts">
              <button type="button" class="btn primary" [disabled]="busy()" (click)="createNew()">
                Я здесь впервые
              </button>
              <button type="button" class="btn" (click)="state.set('login')">
                У меня есть аккаунт
              </button>
            </div>
          }
          @case ('login') {
            <h1>Вход в аккаунт</h1>
            <p class="muted">Пароль спросим один раз — дальше вход из Telegram будет сам.</p>
            <label class="fld">
              <span>Почта или телефон</span>
              <input type="text" autocomplete="username" [(ngModel)]="login" name="login" />
            </label>
            <label class="fld">
              <span>Пароль</span>
              <input
                type="password"
                autocomplete="current-password"
                [(ngModel)]="password"
                name="password"
              />
            </label>
            <div class="acts">
              <button
                type="button"
                class="btn primary"
                [disabled]="busy() || !login.trim() || !password"
                (click)="linkExisting()"
              >
                Войти и привязать
              </button>
              <button type="button" class="btn" (click)="state.set('fork')">Назад</button>
            </div>
          }
          @case ('error') {
            <h1>Не получилось войти</h1>
            <p class="muted">{{ error() }}</p>
            <button type="button" class="btn" (click)="retry()">Попробовать ещё раз</button>
          }
        }
      </div>
    </main>
  `,
  styles: [
    `
      .tg-app {
        display: grid;
        place-items: center;
        min-height: 100dvh;
        padding: 24px 16px;
        background: var(--bg, #fff);
        color: var(--ink, #14161a);
        font-family: inherit;
      }

      .card {
        width: 100%;
        max-width: 420px;
        display: grid;
        gap: 12px;
      }

      h1 {
        margin: 0;
        font-size: 20px;
      }

      .muted {
        margin: 0;
        color: var(--muted, #6b7280);
        font-size: 14px;
        line-height: 1.5;
      }

      .fld {
        display: grid;
        gap: 4px;
        font-size: 13px;
      }

      .fld input {
        padding: 10px 12px;
        border: 1px solid var(--line, #e5e7eb);
        border-radius: 10px;
        font: inherit;
      }

      .acts {
        display: grid;
        gap: 8px;
        margin-top: 4px;
      }

      /* Кнопки во весь лист: палец в мини-аппе целится хуже курсора, а
         места здесь достаточно. */
      .btn {
        display: block;
        width: 100%;
        padding: 12px 16px;
        border: 1px solid var(--line, #e5e7eb);
        border-radius: 12px;
        background: transparent;
        color: inherit;
        font: inherit;
        text-align: center;
        text-decoration: none;
        cursor: pointer;
      }

      .btn.primary {
        border-color: transparent;
        background: var(--accent, #6a4cff);
        color: #fff;
      }
    `,
  ],
})
export class TgEntryPage implements OnInit {
  private readonly auth = inject(AuthSessionStore);

  private readonly router = inject(Router);

  private readonly route = inject(ActivatedRoute);

  public readonly state = signal<'loading' | 'outside' | 'fork' | 'login' | 'error'>('loading');

  public readonly busy = signal(false);

  public readonly error = signal('');

  public login = '';

  public password = '';

  /** Какой бот привёл. От него зависит роль нового человека. */
  private bot: 'creator' | 'client' = 'creator';

  public async ngOnInit(): Promise<void> {
    const param =
      this.route.snapshot.paramMap.get('bot') ?? this.route.snapshot.queryParamMap.get('bot');
    this.bot = param === 'client' ? 'client' : 'creator';

    await loadTelegramScript();
    tgReady();
    if (!isTelegramWebApp()) {
      this.state.set('outside');
      return;
    }
    this.enter({});
  }

  public retry(): void {
    this.state.set('loading');
    this.enter({});
  }

  public createNew(): void {
    this.enter({ create: true });
  }

  public linkExisting(): void {
    this.enter({ login: this.login.trim(), password: this.password });
  }

  private enter(extra: { create?: boolean; login?: string; password?: string }): void {
    this.busy.set(true);
    this.auth.loginWithTelegram({ bot: this.bot, init_data: initData(), ...extra }).subscribe({
      next: () => {
        this.busy.set(false);
        tgHapticResult(true);
        this.go();
      },
      error: (e) => {
        this.busy.set(false);
        const err = parseApiError(e, 'Не удалось войти.');
        // Незнакомый телеграм — не ошибка, а развилка: показываем её
        // вместо экрана с текстом отказа.
        if (err.code === 'telegram_unknown') {
          this.state.set('fork');
          return;
        }
        tgHapticResult(false);
        this.error.set(err.message);
        this.state.set('error');
      },
    });
  }

  /**
   * Куда вести.
   *
   * Сперва — туда, куда звали: в сообщении бота стоит кнопка «Открыть»
   * с адресом конкретной выкладки или заявки, и приводить человека на
   * список проектов после неё значит заставить его искать то, о чём
   * ему только что написали.
   *
   * Адрес проверяем: принимаем только СВОЙ путь из кабинета. Иначе
   * ссылка вида `/tg?to=https://чужой.сайт` уводила бы человека с
   * нашей сессией куда угодно.
   */
  private go(): void {
    const to = this.route.snapshot.queryParamMap.get('to') ?? '';
    if (safeInternalPath(to)) {
      void this.router.navigateByUrl(to, { replaceUrl: true });
      return;
    }

    const roles = this.auth.roles();
    if (roles.includes('admin')) {
      void this.router.navigate(['/admin'], { replaceUrl: true });
      return;
    }
    if (roles.includes('specialist') || roles.includes('manager')) {
      void this.router.navigate(['/me/creator/projects'], { replaceUrl: true });
      return;
    }
    void this.router.navigate(['/me/projects'], { replaceUrl: true });
  }
}

/**
 * Свой ли это путь кабинета.
 *
 * Правила простые и все обязательные: начинается с одного слеша (то
 * есть не `//чужой.сайт` и не `https://…`), ведёт в кабинет или
 * админку, не содержит переводов строк и пробелов. Всё остальное
 * игнорируем молча: человек всё равно попадёт в свой кабинет, просто
 * не на тот экран.
 */
export function safeInternalPath(raw: string): boolean {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//')) return false;
  // Пробелы и обратные слеши: в адресе их не бывает, а в подделке
  // бывают — переводом строки, например, раньше резали заголовки.
  if (/[\s\\]/.test(raw)) return false;
  // Выход вверх по дереву: `/me/../../` формально начинается с /me,
  // а ведёт куда угодно.
  if (raw.split('/').includes('..')) return false;
  return /^\/(me|admin|manager)(\/|$|\?)/.test(raw);
}
