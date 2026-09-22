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
} from '@entities/publication/model/publication.types';
import { ALL_PLATFORMS } from '@entities/publication/model/publication.types';
import { parseApiError } from '@shared/api/api-error';

/**
 * Доступы к аккаунтам бренда.
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
  imports: [CommonModule, FormsModule, NzButtonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './project-accounts.component.html',
  styleUrls: ['./project-accounts.component.scss'],
})
export class ProjectAccountsComponent {
  private readonly api = inject(PublicationApi);
  private readonly msg = inject(NzMessageService);

  public readonly projectId = input.required<string>();

  /** manager правит, client только смотрит. */
  public readonly role = input<'manager' | 'client'>('client');

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

  public readonly empty = computed(() => !this.loading() && this.items().length === 0);

  // Поля формы. Отдельными полями, а не FormGroup: их пять, и все
  // простые строки.
  public form: {
    platform: Platform | 'other';
    title: string;
    url: string;
    login: string;
    password: string;
    note: string;
  } = {
    platform: 'tiktok',
    title: '',
    url: '',
    login: '',
    password: '',
    note: '',
  };

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

  public startAdd(): void {
    this.editing.set('new');
    this.form = { platform: 'tiktok', title: '', url: '', login: '', password: '', note: '' };
  }

  public startEdit(a: ProjectAccount): void {
    this.editing.set(a.id);
    // Пароль в форму не подставляем — мы его не знаем и не должны.
    // Пустое поле значит «оставить как есть», и так подписано.
    this.form = {
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
    const req =
      id === 'new'
        ? this.api.managerAddAccount(this.projectId(), body)
        : this.api.managerUpdateAccount(this.projectId(), id, body);
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
        this.msg.error(parseApiError(e, 'Не удалось сохранить доступ.').message);
      },
    });
  }

  public remove(a: ProjectAccount): void {
    this.busy.set(a.id);
    this.api.managerRemoveAccount(this.projectId(), a.id).subscribe({
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
