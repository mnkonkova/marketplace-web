import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { NzSelectModule } from 'ng-zorro-antd/select';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzMessageService } from 'ng-zorro-antd/message';
import { NZ_MODAL_DATA, NzModalRef } from 'ng-zorro-antd/modal';
import { catchError, debounceTime, distinctUntilChanged, EMPTY, of, Subject, switchMap } from 'rxjs';

import { API_URL } from '@shared/api/api-url.token';
import { ProjectApi } from '@entities/project/api/project.api';

interface SpecialistSearchItem {
  user_id: string;
  email?: string;
  phone?: string;
  display_name?: string;
  kind: string;
}

interface DialogData {
  mode: 'manager' | 'admin';
  projectID: string;
}

@Component({
  selector: 'app-assign-specialist-dialog',
  standalone: true,
  imports: [CommonModule, FormsModule, NzSelectModule, NzButtonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <form class="form" (submit)="$event.preventDefault(); submit()">
      <label>Найти специалиста (email / телефон / имя)</label>
      <nz-select
        [(ngModel)]="specialistID"
        name="s"
        nzPlaceHolder="Введите email, имя или телефон спеца"
        nzShowSearch
        nzServerSearch
        [nzShowArrow]="false"
        [nzFilterOption]="dontFilter"
        (nzOnSearch)="onSearch($event)"
        [nzLoading]="searchLoading()"
        [nzNotFoundContent]="
          candidates().length ? 'Нет совпадений' : 'Начните печатать (мин 2 символа)'
        "
      >
        @for (u of candidates(); track u.user_id) {
          <nz-option [nzValue]="u.user_id" [nzLabel]="formatLabel(u)"></nz-option>
        }
      </nz-select>

      <div class="actions">
        <button nz-button type="button" (click)="cancel()">Отмена</button>
        <button nz-button nzType="primary" type="submit" [nzLoading]="saving()">
          Назначить
        </button>
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
        margin: 4px 0;
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
export class AssignSpecialistDialogComponent {
  private readonly modalRef = inject(NzModalRef);

  private readonly api = inject(ProjectApi);

  private readonly http = inject(HttpClient);

  private readonly apiBase = inject(API_URL);

  private readonly msg = inject(NzMessageService);

  public readonly data = inject<DialogData>(NZ_MODAL_DATA);

  public readonly candidates = signal<SpecialistSearchItem[]>([]);

  public readonly searchLoading = signal(false);

  public readonly saving = signal(false);

  public specialistID = '';

  public readonly dontFilter = () => true;

  private readonly q$ = new Subject<string>();

  public constructor() {
    this.q$
      .pipe(
        debounceTime(250),
        distinctUntilChanged(),
        switchMap((q) => {
          if (q.trim().length < 2) return of<SpecialistSearchItem[]>([]);
          this.searchLoading.set(true);
          return this.http
            .get<{ items: SpecialistSearchItem[] }>(
              `${this.apiBase}/manager/users/search`,
              { params: { q, kind: 'specialist' } },
            )
            .pipe(catchError(() => of({ items: [] as SpecialistSearchItem[] })));
        }),
      )
      .subscribe((r) => {
        this.searchLoading.set(false);
        const items = Array.isArray(r) ? r : r.items;
        this.candidates.set(items);
      });
  }

  public onSearch(q: string): void {
    this.q$.next(q);
  }

  public formatLabel(u: SpecialistSearchItem): string {
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
    if (!this.specialistID) {
      this.msg.error('Выберите специалиста.');
      return;
    }
    this.saving.set(true);
    const req =
      this.data.mode === 'admin'
        ? this.api.adminAssignSpecialist(this.data.projectID, this.specialistID)
        : this.api.managerAssignSpecialist(this.data.projectID, this.specialistID);
    req
      .pipe(
        catchError((e) => {
          this.saving.set(false);
          const msg = e?.error?.message || 'Не удалось назначить.';
          this.msg.error(msg);
          return EMPTY;
        }),
      )
      .subscribe(() => {
        this.saving.set(false);
        this.msg.success('Специалист назначен');
        this.modalRef.destroy(this.specialistID);
      });
  }
}
