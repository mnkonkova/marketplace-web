import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { NzInputModule } from 'ng-zorro-antd/input';
import { NzInputNumberModule } from 'ng-zorro-antd/input-number';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzRadioModule } from 'ng-zorro-antd/radio';
import { NzSelectModule } from 'ng-zorro-antd/select';
import { NzMessageService } from 'ng-zorro-antd/message';
import { NZ_MODAL_DATA, NzModalRef } from 'ng-zorro-antd/modal';
import { catchError, EMPTY } from 'rxjs';

import { ProjectApi, CreateProjectPayload } from '@entities/project/api/project.api';
import { PipelineApi } from '@entities/pipeline/api/pipeline.api';

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
        <label>UUID клиента</label>
        <input
          nz-input
          [(ngModel)]="clientUserID"
          name="cu"
          placeholder="00000000-0000-0000-0000-000000000000"
        />
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

  private readonly msg = inject(NzMessageService);

  private readonly router = inject(Router);

  public readonly data = inject<DialogData>(NZ_MODAL_DATA);

  public readonly pipelines = signal<Array<{ id: string; name: string; is_default: boolean }>>([]);

  public readonly saving = signal(false);

  public clientMode: 'no_account' | 'registered' = 'no_account';
  public clientUserID = '';
  public clientName = '';
  public clientContact = '';
  public title = '';
  public pipelineID = '';
  public notes = '';
  public budget: number | null = null;

  public constructor() {
    this.pipelineApi.list().subscribe((r) => {
      this.pipelines.set(r.items.map((p) => ({ id: p.id, name: p.name, is_default: p.is_default })));
      const def = r.items.find((p) => p.is_default);
      if (def) this.pipelineID = def.id;
    });
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
        const route = this.data.mode === 'admin'
          ? ['/admin/projects', created.id]
          : ['/manager/projects', created.id];
        void this.router.navigate(route);
      });
  }
}
