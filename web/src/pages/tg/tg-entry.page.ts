import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { NzMessageService } from 'ng-zorro-antd/message';

import { AuthSessionStore } from '@entities/auth/model/auth-session.store';
import { TelegramApi } from '@entities/telegram/api/telegram.api';
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
            <!-- Регистрации здесь нет намеренно (решение владельца от
                 27 сентября).
                 Аккаунт заводится на сайте: там анкета, категории и
                 портфолио — без них в проект всё равно не позовут, а
                 заполнять их в окне Telegram неудобно. Но главное
                 другое: «я новый» нажимали и те, у кого аккаунт давно
                 есть, и телеграм привязывался к пустому дублю. Второй
                 раз развилку такому человеку уже не покажут — телеграм
                 стал знакомым, — и разбирать это приходилось руками в
                 базе. -->
            <h1>Первый раз здесь?</h1>
            <p class="muted">
              Мы не нашли аккаунт, привязанный к этому телеграму. Если он у вас есть — войдите, и
              телеграм привяжется к нему. Если нет — анкета заполняется на сайте, откроем её в
              браузере.
            </p>
            <div class="acts">
              <button type="button" class="btn primary" (click)="state.set('login')">
                У меня есть аккаунт
              </button>
              <button type="button" class="btn" [disabled]="busy()" (click)="registerOnSite()">
                Я здесь впервые
              </button>
            </div>
            <p class="muted">
              Входите через Яндекс?
              <button type="button" class="linky" (click)="state.set('yandex')">
                Пароля у вас нет — вот что делать
              </button>
            </p>
          }
          @case ('yandex') {
            <!-- Вход через Яндекс внутри мини-аппа невозможен: он
                 уводит в браузер, и сессия остаётся там. Поэтому не
                 прячем тупик за кнопкой, а объясняем обходной путь —
                 он короткий и работает. -->
            <h1>Вы входите через Яндекс</h1>
            <p class="muted">
              Пароля у такого аккаунта нет, и спрашивать его здесь бессмысленно. Есть два пути, оба
              короткие.
            </p>
            <p class="muted"><b>Привязать из кабинета</b> — ничего не заводя:</p>
            <ol class="steps">
              <li>откройте сайт в браузере и войдите через Яндекс;</li>
              <li>в любом своём проекте нажмите «Получать уведомления в Telegram»;</li>
              <li>перейдите по ссылке — она приведёт сюда и всё свяжет.</li>
            </ol>
            <!-- Второй путь называем прямо: «Забыли пароль» у аккаунта
                 из Яндекса звучит странно, но работает именно он —
                 старого пароля там не спрашивают, а почта уже
                 подтверждена. -->
            <p class="muted">
              <b>Или завести пароль</b>: на сайте в окне входа нажмите «Забыли пароль?» — придёт
              письмо на вашу почту из Яндекса. Старый пароль там не спрашивают, потому что его и
              нет. После этого сюда можно входить почтой и паролем.
            </p>
            <div class="acts">
              <button type="button" class="btn primary" (click)="openSite()">
                Открыть сайт в браузере
              </button>
              <button type="button" class="btn" (click)="state.set('fork')">Назад</button>
            </div>
          }
          @case ('login') {
            <h1>Вход в аккаунт</h1>
            <p class="muted">Пароль спросим один раз — дальше вход из Telegram будет сам.</p>
            <!-- Про Яндекс говорим ДО того, как человек трижды введёт
                 несуществующий пароль и решит, что сломались мы. -->
            <p class="muted">
              Входите через Яндекс?
              <button type="button" class="linky" (click)="state.set('yandex')">
                Пароля у вас нет — вот что делать
              </button>
            </p>
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
      /* Цвета берём у самого Telegram, а не у сайта.
         Экран живёт внутри его окна, и тема там своя — светлая или
         тёмная по настройке человека, а не по нашей. Смешение двух
         словарей и дало то, что было видно: заголовок белый, а текст
         кнопки — цвета «чернил» светлой темы, то есть невидимый на
         чёрном. Запасные значения — на случай, когда переменных нет
         (старый клиент или наш же браузер на стенде). */
      :host {
        --tg-bg: var(--tg-theme-bg-color, #ffffff);
        --tg-text: var(--tg-theme-text-color, #14161a);
        --tg-hint: var(--tg-theme-hint-color, #6b7280);
        --tg-btn: var(--tg-theme-button-color, #2f3fc8);
        --tg-btn-text: var(--tg-theme-button-text-color, #ffffff);
        --tg-field: var(--tg-theme-secondary-bg-color, #f1f3f6);
      }

      .tg-app {
        display: grid;
        place-items: center;
        min-height: 100dvh;
        padding: 24px 16px;
        background: var(--tg-bg);
        color: var(--tg-text);
        font-family: inherit;
      }

      .card {
        display: grid;
        width: 100%;
        max-width: 420px;
        gap: 12px;
      }

      h1 {
        margin: 0;
        color: var(--tg-text);
        font-size: 20px;
      }

      .muted {
        margin: 0;
        color: var(--tg-hint);
        font-size: 14px;
        line-height: 1.5;
      }

      .fld {
        display: grid;
        color: var(--tg-hint);
        font-size: 13px;
        gap: 4px;
      }

      .fld input {
        padding: 12px;
        border: 1px solid transparent;
        border-radius: 10px;
        background: var(--tg-field);
        color: var(--tg-text);
        font: inherit;
      }

      .acts {
        display: grid;
        margin-top: 4px;
        gap: 8px;
      }

      /* Кнопки во весь лист: палец в мини-аппе целится хуже курсора, а
         места здесь достаточно. Цвет текста задан явно — «inherit» и
         приводил к невидимой надписи. */
      .btn {
        display: block;
        width: 100%;
        padding: 13px 16px;
        border: 1px solid color-mix(in srgb, var(--tg-hint) 45%, transparent);
        border-radius: 12px;
        background: transparent;
        color: var(--tg-text);
        font: inherit;
        font-weight: 500;
        text-align: center;
        text-decoration: none;
        cursor: pointer;
      }

      .btn.primary {
        border-color: transparent;
        background: var(--tg-btn);
        color: var(--tg-btn-text);
      }

      .btn[disabled] {
        opacity: 0.5;
      }

      .steps {
        margin: 0;
        padding-left: 20px;
        color: var(--tg-text);
        font-size: 14px;
        line-height: 1.6;
      }

      /* Ссылка внутри абзаца, а не кнопка: по смыслу это переход к
         объяснению. Кнопкой она остаётся ради доступности — её видно
         с клавиатуры и читает скринридер. */
      .linky {
        padding: 0;
        border: 0;
        background: none;
        color: var(--tg-btn);
        font: inherit;
        text-decoration: underline;
        cursor: pointer;
      }
    `,
  ],
})
export class TgEntryPage implements OnInit {
  private readonly auth = inject(AuthSessionStore);

  private readonly router = inject(Router);

  private readonly route = inject(ActivatedRoute);

  private readonly telegram = inject(TelegramApi);

  private readonly msg = inject(NzMessageService);

  public readonly state = signal<'loading' | 'outside' | 'fork' | 'login' | 'yandex' | 'error'>(
    'loading',
  );

  public readonly busy = signal(false);

  public readonly error = signal('');

  public login = '';

  public password = '';

  /** Какой бот привёл. От него зависит роль в анкете. */
  private bot: 'creator' | 'client' = 'creator';

  /**
   * «Я здесь впервые» — регистрация в браузере, но телеграм
   * привязывается сам.
   *
   * Берём у сервера одноразовый билет (он проверяет подпись Telegram)
   * и кладём его в адрес анкеты. Браузер погасит его сразу после
   * регистрации, и возвращаться в бот человеку не придётся — он уже
   * получил, зачем приходил, и половина бы не вернулась.
   *
   * Билет не выдался — всё равно открываем анкету: зарегистрироваться
   * важнее, чем привязать бота, а привязку потом сделает кнопка в
   * проекте.
   */
  public registerOnSite(): void {
    this.busy.set(true);
    this.telegram.linkTicket(this.bot, initData()).subscribe({
      next: (res) => {
        this.busy.set(false);
        this.openSite(`${this.registerPath}&tg=${encodeURIComponent(res.code)}`);
      },
      error: () => {
        this.busy.set(false);
        this.openSite(this.registerPath);
      },
    });
  }

  /**
   * Куда ведёт регистрация.
   *
   * Мастер профиля, а не главная: роль уже известна по боту, и
   * спрашивать её второй раз незачем. Страница публичная — человек
   * приходит на неё незарегистрированным, там же и заводит аккаунт.
   */
  public get registerPath(): string {
    return this.bot === 'creator' ? '/start?role=specialist' : '/start?role=client';
  }

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

  /**
   * Открыть страницу сайта в браузере.
   *
   * Через openLink самого Telegram: переход внутри webview оставил бы
   * человека в мини-аппе без его собственной шапки, а регистрация и
   * вход через Яндекс всё равно уводят наружу.
   *
   * Ведём сразу в нужное место — в анкету, а не на главную: человек
   * пришёл регистрироваться, и искать кнопку на витрине его
   * заставлять незачем.
   */
  public openSite(path = ''): void {
    const url = window.location.origin + path;
    const tg = (window as unknown as { Telegram?: { WebApp?: { openLink?: (u: string) => void } } })
      .Telegram?.WebApp;
    try {
      if (tg?.openLink) {
        tg.openLink(url);
        return;
      }
    } catch {
      /* старый клиент — уходим обычной ссылкой */
    }
    window.open(url, '_blank', 'noopener');
  }

  public linkExisting(): void {
    this.enter({ login: this.login.trim(), password: this.password });
  }

  private enter(extra: { login?: string; password?: string }): void {
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
    // Менеджер — в проекты, которые он ВЕДЁТ: это его работа, а
    // «мои проекты» у него про другое (там он креатор, если вообще
    // числится в составе). Канбан в мини-аппе исключён решением
    // владельца — он не работает пальцем, — поэтому список.
    if (roles.includes('manager')) {
      void this.router.navigate(['/manager/projects'], { replaceUrl: true });
      return;
    }
    if (roles.includes('specialist')) {
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
