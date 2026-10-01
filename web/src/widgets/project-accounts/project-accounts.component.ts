import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzMessageService } from 'ng-zorro-antd/message';

import { PublicationApi } from '@entities/publication/api/publication.api';
import { PLATFORM_LABEL } from '@entities/publication/lib/publication-status';
import type {
  Platform,
  ProjectAccount,
  ProjectAccountInput,
  ProjectPerson,
} from '@entities/publication/model/publication.types';
import { ALL_PLATFORMS } from '@entities/publication/model/publication.types';
import { parseApiError } from '@shared/api/api-error';
import { SheetComponent } from '@shared/ui/sheet/sheet.component';
import { isTouchDevice } from '@shared/lib/touch';

/**
 * Аккаунты, с которых выходят ролики.
 *
 * Заполняет менеджер, читает заказчик: ролики выходят с аккаунтов
 * клиента, и он вправе знать, где они, под каким логином и как их
 * забрать обратно. До сих пор это жило в переписке — то есть нигде.
 *
 * Пароль в списке не показывается. Не из осторожности «на всякий
 * случай»: экран проекта показывают начальству и вставляют в
 * коммерческое, и пароль от аккаунта бренда там появляться не должен.
 * Его берут явным нажатием, и это нажатие видно в логах сервиса.
 */
@Component({
  selector: 'app-project-accounts',
  standalone: true,
  imports: [CommonModule, FormsModule, NzButtonModule, SheetComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './project-accounts.component.html',
  styleUrls: ['./project-accounts.component.scss'],
})
export class ProjectAccountsComponent {
  private readonly api = inject(PublicationApi);
  private readonly msg = inject(NzMessageService);

  public readonly projectId = input.required<string>();

  /**
   * На тач-экране форма доступа открывается нижним листом: полей в ней
   * шесть, и раскрытая в середине списка она уезжает за край экрана.
   */
  public readonly touch = isTouchDevice();

  /**
   * Кто смотрит. manager ведёт все доступы проекта, client только
   * смотрит, creator — свои и только свои.
   *
   * У креатора это «Мои аккаунты» на странице проекта: под проект он
   * заводит отдельные аккаунты, а не даёт личную страницу из профиля, и
   * ведёт их сам. Менеджер не знает, с какого именно человек решил
   * выкладывать, и пересылка этого через чат — тот самый шаг, ради
   * устранения которого блок и нужен.
   */
  public readonly role = input<'manager' | 'client' | 'creator'>('client');

  /**
   * Состав проекта: доступы раскладываются ПО ЛЮДЯМ.
   *
   * Ролики выходят с аккаунтов креаторов, а не с общего аккаунта
   * бренда. Общим списком это читалось как чужая связка ключей: пять
   * строк, и непонятно, кому какая принадлежит и с кого спрашивать,
   * когда ссылка перестала отвечать.
   *
   * Пусто — раскладывать не по кому: показываем одним списком, как
   * раньше (так и у заказчика, если состав ему не передали).
   */
  public readonly creators = input<readonly ProjectPerson[]>([]);

  public readonly items = signal<ProjectAccount[]>([]);

  public readonly loading = signal(true);

  /**
   * У сервиса нет ключа шифрования — пароли не хранятся вовсе.
   * Показываем это словами: иначе «поле пароля куда-то делось».
   */
  public readonly secretsEnabled = signal(true);

  /** Показанные пароли: id → значение. Живут только до перезагрузки. */
  public readonly revealed = signal<Record<string, string>>({});

  public readonly busy = signal<string | null>(null);

  /** Какой доступ правим. 'new' — форма добавления. */
  public readonly editing = signal<string | null>(null);

  public readonly platforms: (Platform | 'other')[] = [...ALL_PLATFORMS, 'other'];

  public readonly isManager = computed(() => this.role() === 'manager');

  public readonly isCreator = computed(() => this.role() === 'creator');

  /** Кто может править: владелец своих строк и менеджер проекта. */
  public readonly canEdit = computed(() => this.role() !== 'client');

  public readonly empty = computed(() => !this.loading() && this.items().length === 0);

  // Поля формы. Отдельными полями, а не FormGroup: их пять, и все
  // простые строки.
  public form: {
    /** Чей аккаунт. Пусто — доступ без владельца (почта, кабинет). */
    creatorUserId: string;
    platform: Platform | 'other';
    title: string;
    url: string;
    login: string;
    password: string;
    note: string;
  } = {
    creatorUserId: '',
    platform: 'tiktok',
    title: '',
    url: '',
    login: '',
    password: '',
    note: '',
  };

  /**
   * Доступы по людям: у каждого креатора свои аккаунты и своя кнопка
   * «Добавить». Последней группой — то, у чего владельца нет: почта,
   * рекламный кабинет, аккаунт самого бренда.
   *
   * Раскладывать не по кому — показываем ОДНИМ списком, и в нём всё, что
   * пришло. Раньше в такой список попадали только строки без владельца,
   * а остальные молча исчезали: у креатора в «Моих аккаунтах» все строки
   * с владельцем — он сам, — и список выходил пустым. Человек заводил
   * аккаунт заново и получал 409 «уже заведён» на то, чего не видел.
   */
  public readonly groups = computed(() => {
    const byOwner = new Map<string, ProjectAccount[]>();
    for (const a of this.items()) {
      const key = a.creator_user_id ?? '';
      byOwner.set(key, [...(byOwner.get(key) ?? []), a]);
    }
    if (!this.creators().length) {
      return [
        {
          id: '',
          // У креатора группа одна — его собственная, и заголовок у
          // блока уже «Мои аккаунты». Повторять его строкой ниже
          // значит напечатать одно и то же дважды подряд: так и было
          // на телефоне, где между ними не остаётся воздуха.
          title: this.isCreator() ? '' : 'Доступы',
          accounts: this.items(),
        },
      ];
    }
    const out = this.creators().map((c) => ({
      id: c.user_id,
      title: c.display_name,
      accounts: byOwner.get(c.user_id) ?? [],
    }));
    const rest = byOwner.get('') ?? [];
    // Группа «прочих» показывается, только если в ней что-то есть:
    // пустой заголовок «Прочие доступы» на каждом проекте — это строка,
    // которая ничего не говорит.
    if (rest.length) {
      out.push({ id: '', title: 'Прочие доступы', accounts: rest });
    }
    return out;
  });

  public constructor() {
    effect(() => {
      const id = this.projectId();
      if (!id) return;
      this.load(id);
    });
  }

  private load(projectId: string): void {
    this.loading.set(true);
    const req = this.isManager()
      ? this.api.managerAccounts(projectId)
      : this.isCreator()
        ? this.api.creatorAccounts(projectId)
        : this.api.clientAccounts(projectId);
    req.subscribe({
      next: (r) => {
        this.items.set(r.items ?? []);
        this.secretsEnabled.set(r.secrets_enabled !== false);
        this.loading.set(false);
      },
      error: () => {
        this.items.set([]);
        this.loading.set(false);
      },
    });
  }

  public label(a: ProjectAccount): string {
    if (a.title) return a.title;
    return a.platform === 'other' ? 'Доступ' : PLATFORM_LABEL[a.platform as Platform];
  }

  public platformLabel(p: Platform | 'other'): string {
    return p === 'other' ? 'Другое' : PLATFORM_LABEL[p];
  }

  public password(a: ProjectAccount): string | null {
    return this.revealed()[a.id] ?? null;
  }

  /**
   * Показать пароль. Отдельный запрос, а не поле в списке: так пароль не
   * оказывается на экране у того, кто его не спрашивал.
   */
  public reveal(a: ProjectAccount): void {
    if (this.password(a)) {
      const next = { ...this.revealed() };
      delete next[a.id];
      this.revealed.set(next);
      return;
    }
    this.busy.set(a.id);
    const req = this.isManager()
      ? this.api.managerAccountSecret(this.projectId(), a.id)
      : this.isCreator()
        ? this.api.creatorAccountSecret(this.projectId(), a.id)
        : this.api.clientAccountSecret(this.projectId(), a.id);
    req.subscribe({
      next: (r) => {
        this.busy.set(null);
        this.revealed.set({ ...this.revealed(), [a.id]: r.password });
      },
      error: (e) => {
        this.busy.set(null);
        this.msg.error(parseApiError(e, 'Не удалось показать пароль.').message);
      },
    });
  }

  public copy(value: string): void {
    void navigator.clipboard?.writeText(value).then(
      () => this.msg.success('Скопировано'),
      () => this.msg.error('Браузер не дал скопировать — выделите руками.'),
    );
  }

  /** Завести доступ. creatorUserId пуст — брендовый, без владельца. */
  public startAdd(creatorUserId = ''): void {
    this.editing.set('new');
    this.form = {
      creatorUserId,
      platform: 'tiktok',
      title: '',
      url: '',
      login: '',
      password: '',
      note: '',
    };
  }

  /** Чей аккаунт правим — подпись в форме. Пусто у брендовых. */
  public ownerName(): string {
    const id = this.form.creatorUserId;
    if (!id) return '';
    return this.creators().find((c) => c.user_id === id)?.display_name ?? '';
  }

  /** Форма добавления открыта для этой группы. */
  public addingFor(creatorUserId: string): boolean {
    return this.editing() === 'new' && this.form.creatorUserId === creatorUserId;
  }

  public startEdit(a: ProjectAccount): void {
    this.editing.set(a.id);
    // Пароль в форму не подставляем — мы его не знаем и не должны.
    // Пустое поле значит «оставить как есть», и так подписано.
    this.form = {
      creatorUserId: a.creator_user_id ?? '',
      platform: a.platform,
      title: a.title,
      url: a.url,
      login: a.login,
      password: '',
      note: a.note,
    };
  }

  public cancel(): void {
    this.editing.set(null);
  }

  private payload(clearPassword: boolean): ProjectAccountInput {
    const out: ProjectAccountInput = {
      creator_user_id: this.form.creatorUserId || undefined,
      platform: this.form.platform,
      title: this.form.title.trim(),
      url: this.form.url.trim(),
      login: this.form.login.trim(),
      note: this.form.note.trim(),
    };
    const pass = this.form.password;
    if (clearPassword) out.password = '';
    else if (pass) out.password = pass;
    return out;
  }

  public save(clearPassword = false): void {
    const id = this.editing();
    if (!id) return;
    const body = this.payload(clearPassword);
    if (!body.title && !body.url && !body.login) {
      this.msg.error('Нужны хотя бы ссылка, логин или название — иначе это пустая строка.');
      return;
    }
    this.busy.set(id);
    const add = this.isCreator() ? this.api.creatorAddAccount : this.api.managerAddAccount;
    const upd = this.isCreator() ? this.api.creatorUpdateAccount : this.api.managerUpdateAccount;
    const req =
      id === 'new'
        ? add.call(this.api, this.projectId(), body)
        : upd.call(this.api, this.projectId(), id, body);
    req.subscribe({
      next: (saved) => {
        this.busy.set(null);
        this.editing.set(null);
        this.items.set(
          id === 'new'
            ? [...this.items(), saved]
            : this.items().map((a) => (a.id === saved.id ? saved : a)),
        );
        // Показанный пароль после правки протух: он мог смениться.
        const next = { ...this.revealed() };
        delete next[saved.id];
        this.revealed.set(next);
        this.msg.success(id === 'new' ? 'Доступ добавлен' : 'Доступ сохранён');
      },
      error: (e) => {
        this.busy.set(null);
        const err = parseApiError(e, 'Не удалось сохранить доступ.');
        // «Такой уже есть» — не отказ, а подсказка, куда идти.
        //
        // У человека по одной строке на площадку, и заводя вторую, он
        // почти всегда хочет заменить адрес в первой: аккаунт сменили,
        // ролики теперь выходят с другого. Раньше ему отвечали красной
        // плашкой «поправьте существующий», и он шёл искать её глазами
        // сам. Теперь переключаем на ту самую строку и переносим в неё
        // то, что он уже набрал.
        if (err.code === 'account_exists') {
          const existing = this.items().find(
            (a) =>
              a.platform === body.platform &&
              (a.creator_user_id ?? '') === (body.creator_user_id ?? ''),
          );
          if (existing) {
            this.editing.set(existing.id);
            this.msg.info('Аккаунт этой площадки уже заведён — правим его.');
            return;
          }
        }
        this.msg.error(err.message);
      },
    });
  }

  public remove(a: ProjectAccount): void {
    this.busy.set(a.id);
    const req = this.isCreator()
      ? this.api.creatorRemoveAccount(this.projectId(), a.id)
      : this.api.managerRemoveAccount(this.projectId(), a.id);
    req.subscribe({
      next: () => {
        this.busy.set(null);
        this.items.set(this.items().filter((x) => x.id !== a.id));
        this.msg.success('Доступ удалён');
      },
      error: (e) => {
        this.busy.set(null);
        this.msg.error(parseApiError(e, 'Не удалось удалить доступ.').message);
      },
    });
  }
}
