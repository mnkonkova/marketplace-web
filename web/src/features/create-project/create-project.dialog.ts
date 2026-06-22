import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { NzInputModule } from 'ng-zorro-antd/input';
import { NzInputNumberModule } from 'ng-zorro-antd/input-number';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzRadioModule } from 'ng-zorro-antd/radio';
import { NzSelectModule } from 'ng-zorro-antd/select';
import { NzMessageService } from 'ng-zorro-antd/message';
import { NZ_MODAL_DATA, NzModalRef } from 'ng-zorro-antd/modal';
import { catchError, debounceTime, distinctUntilChanged, EMPTY, of, Subject, switchMap } from 'rxjs';

import { API_URL } from '@shared/api/api-url.token';
import { ProjectApi, CreateProjectPayload } from '@entities/project/api/project.api';
import { PipelineApi } from '@entities/pipeline/api/pipeline.api';

interface UserSearchItem {
  user_id: string;
  email?: string;
  phone?: string;
  display_name?: string;
  kind: string;
}

type Mode = 'manager' | 'admin';

interface DialogData {
  mode: Mode;
}

@Component({
  selector: 'app-create-project-dialog',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    NzInputModule,
    NzInputNumberModule,
    NzButtonModule,
    NzRadioModule,
    NzSelectModule,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <form class="form" (submit)="$event.preventDefault(); submit()">
      <label>Тип клиента</label>
      <nz-radio-group [(ngModel)]="clientMode" name="cm">
        <label nz-radio nzValue="no_account">Без аккаунта (есть только контакт)</label>
        <label nz-radio nzValue="registered">Зарегистрированный (UUID)</label>
      </nz-radio-group>

      @if (clientMode === 'no_account') {
        <label>Имя клиента</label>
        <input nz-input [(ngModel)]="clientName" name="cn" placeholder="Анна Петрова" />
        <label>Контакт (телефон, telegram, email)</label>
        <input nz-input [(ngModel)]="clientContact" name="cc" placeholder="+79991234567" />
      } @else {
        <label>Найти клиента (email / телефон / имя)</label>
        <nz-select
          [(ngModel)]="clientUserID"
          name="cu"
          nzPlaceHolder="Введите email, имя или телефон"
          nzShowSearch
          nzServerSearch
          [nzShowArrow]="false"
          [nzFilterOption]="dontFilter"
          (nzOnSearch)="onClientSearch($event)"
          [nzLoading]="clientSearchLoading()"
          [nzNotFoundContent]="clientCandidates().length ? 'Нет совпадений' : 'Начните печатать (мин 2 символа)'"
        >
          @for (u of clientCandidates(); track u.user_id) {
            <nz-option [nzValue]="u.user_id" [nzLabel]="formatUserLabel(u)"></nz-option>
          }
        </nz-select>
      }

      <label>Название проекта</label>
      <input nz-input [(ngModel)]="title" name="t" placeholder="Промо-ролик к запуску" />

      <label>Воронка</label>
      <nz-select [(ngModel)]="pipelineID" name="pl" nzPlaceHolder="Выберите воронку">
        @for (p of pipelines(); track p.id) {
          <nz-option [nzValue]="p.id" [nzLabel]="p.name + (p.is_default ? ' (default)' : '')"></nz-option>
        }
      </nz-select>

      <label>Бюджет (опционально, ₽)</label>
      <nz-input-number [(ngModel)]="budget" name="b" [nzMin]="0" style="width: 100%"></nz-input-number>

      <label>Заметки (бриф/детали)</label>
      <textarea
        nz-input
        rows="3"
        [(ngModel)]="notes"
        name="nt"
        placeholder="Что хочет клиент, дедлайны, бюджет"
      ></textarea>

      <div class="actions">
        <button nz-button type="button" (click)="cancel()">Отмена</button>
        <button nz-button nzType="primary" type="submit" [nzLoading]="saving()">Создать</button>
      </div>
    </form>
  `,
  styles: [
    `
      .form {
        display: flex;
        flex-direction: column;
        gap: 6px;
      }
      label {
        margin-top: 6px;
        font-size: 12px;
        color: var(--text-muted);
      }
      .actions {
        display: flex;
        gap: 8px;
        justify-content: flex-end;
        margin-top: 16px;
      }
    `,
  ],
})
export class CreateProjectDialogComponent {
  private readonly modalRef = inject(NzModalRef);

  private readonly api = inject(ProjectApi);

  private readonly pipelineApi = inject(PipelineApi);

  private readonly http = inject(HttpClient);

  private readonly apiBase = inject(API_URL);

  private readonly msg = inject(NzMessageService);

  private readonly router = inject(Router);

  public readonly data = inject<DialogData>(NZ_MODAL_DATA);

  public readonly pipelines = signal<Array<{ id: string; name: string; is_default: boolean }>>([]);

  public readonly saving = signal(false);

  public readonly clientCandidates = signal<UserSearchItem[]>([]);

  public readonly clientSearchLoading = signal(false);

  public clientMode: 'no_account' | 'registered' = 'no_account';
  public clientUserID = '';
  public clientName = '';
  public clientContact = '';
  public title = '';
  public pipelineID = '';
  public notes = '';
  public budget: number | null = null;

  // NzSelect фильтрует своими силами по nzLabel — это плохо для server-search.
  // Выключаем: возвращаем все результаты как есть, бек уже отфильтровал.
  public readonly dontFilter = () => true;

  private readonly clientQ$ = new Subject<string>();

  public constructor() {
    // Admin тянет /admin/pipelines (полные права), manager — /manager/pipelines
    // (read-only). Без mode-разделения у менеджера был 403 на admin-роуте.
    const data = inject<DialogData>(NZ_MODAL_DATA, { optional: true }) ?? { mode: 'manager' as Mode };
    const pipelines$ = data.mode === 'admin' ? this.pipelineApi.list() : this.pipelineApi.listForManager();
    pipelines$.subscribe((r) => {
      this.pipelines.set(r.items.map((p) => ({ id: p.id, name: p.name, is_default: p.is_default })));
      const def = r.items.find((p) => p.is_default);
      if (def) this.pipelineID = def.id;
    });
    // Live-search клиентов: 250ms debounce, отбрасываем повторы. Сервер
    // лимитирует 20 results — больше не загружаем.
    this.clientQ$
      .pipe(
        debounceTime(250),
        distinctUntilChanged(),
        switchMap((q) => {
          if (q.trim().length < 2) return of<UserSearchItem[]>([]);
          this.clientSearchLoading.set(true);
          return this.http
            .get<{ items: UserSearchItem[] }>(
              `${this.apiBase}/manager/users/search`,
              { params: { q, kind: 'client' } },
            )
            .pipe(catchError(() => of({ items: [] as UserSearchItem[] })));
        }),
      )
      .subscribe((r) => {
        this.clientSearchLoading.set(false);
        const items = Array.isArray(r) ? r : r.items;
        this.clientCandidates.set(items);
      });
  }

  public onClientSearch(q: string): void {
    this.clientQ$.next(q);
  }

  public formatUserLabel(u: UserSearchItem): string {
    const parts: string[] = [];
    if (u.display_name) parts.push(u.display_name);
    if (u.email) parts.push(u.email);
    if (u.phone) parts.push(u.phone);
    return parts.join(' · ');
  }

  public cancel(): void {
    this.modalRef.destroy();
  }

  public submit(): void {
    const t = this.title.trim();
    if (!t) {
      this.msg.error('Укажите название проекта.');
      return;
    }
    if (!this.pipelineID) {
      this.msg.error('Выберите воронку.');
      return;
    }
    const payload: CreateProjectPayload = {
      pipeline_id: this.pipelineID,
      title: t,
      notes: this.notes.trim(),
    };
    if (this.budget != null) payload.budget = this.budget;
    if (this.clientMode === 'registered') {
      const uid = this.clientUserID.trim();
      if (!uid) {
        this.msg.error('Укажите UUID клиента.');
        return;
      }
      payload.client_user_id = uid;
    } else {
      const cn = this.clientName.trim();
      const cc = this.clientContact.trim();
      if (!cn || !cc) {
        this.msg.error('Укажите имя и контакт клиента.');
        return;
      }
      payload.client_name = cn;
      payload.client_contact = cc;
    }
    this.saving.set(true);
    const req = this.data.mode === 'admin'
      ? this.api.adminCreateProject(payload)
      : this.api.managerCreateProject(payload);
    req
      .pipe(
        catchError((e) => {
          this.saving.set(false);
          const msg = e?.error?.message || 'Не удалось создать проект.';
          this.msg.error(msg);
          return EMPTY;
        }),
      )
      .subscribe((created) => {
        this.saving.set(false);
        this.msg.success('Проект создан');
        this.modalRef.destroy(created);
        // Отдельной /admin/projects/:id страницы нет — manager-project-detail
        // пропускает admin через requireRole('manager','admin'). Используем
        // его для обоих режимов. Раньше admin-mode шёл на несуществующий
        // /admin/projects/<uuid> → router падал в wildcard → юзера выкидывало
        // на главную.
        void this.router.navigate(['/manager/projects', created.id]);
      });
  }
}
