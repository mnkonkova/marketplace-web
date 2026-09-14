import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzMessageService } from 'ng-zorro-antd/message';
import { NzSelectModule } from 'ng-zorro-antd/select';
import { NZ_MODAL_DATA, NzModalRef } from 'ng-zorro-antd/modal';
import {
  EMPTY,
  Subject,
  catchError,
  debounceTime,
  distinctUntilChanged,
  of,
  switchMap,
} from 'rxjs';

import { API_URL } from '@shared/api/api-url.token';
import { PublicationApi } from '@entities/publication/api/publication.api';
import { parseApiError } from '@shared/api/api-error';

interface CreatorSearchItem {
  user_id: string;
  email?: string;
  phone?: string;
  display_name?: string;
  kind: string;
}

export interface AddCreatorDialogData {
  projectID: string;
}

// Добавить креатора в состав проекта. Поиск тот же, что у назначения
// специалиста (/manager/users/search), но ручка другая: состав проекта
// и исполнитель по воронке — разные вещи.
@Component({
  selector: 'app-add-creator-dialog',
  standalone: true,
  imports: [CommonModule, FormsModule, NzSelectModule, NzButtonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <form class="form" (submit)="$event.preventDefault(); submit()">
      <label>Найти креатора (email / телефон / имя)</label>
      <nz-select
        [(ngModel)]="creatorID"
        name="c"
        nzPlaceHolder="Введите email, имя или телефон"
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

      <p class="hint">
        Сразу после добавления креатор увидит проект, свои даты и чеклист выкладки.
      </p>

      <div class="actions">
        <button nz-button type="button" (click)="cancel()">Отмена</button>
        <button nz-button nzType="primary" type="submit" [nzLoading]="saving()">Добавить</button>
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
        color: var(--text-muted);
        font-size: 12px;
      }
      .hint {
        margin: 8px 0 0;
        color: var(--text-muted);
        font-size: 12px;
      }
      .actions {
        display: flex;
        justify-content: flex-end;
        gap: 8px;
        margin-top: 16px;
      }
    `,
  ],
})
export class AddCreatorDialogComponent {
  private readonly modalRef = inject(NzModalRef);

  private readonly api = inject(PublicationApi);

  private readonly http = inject(HttpClient);

  private readonly apiBase = inject(API_URL);

  private readonly msg = inject(NzMessageService);

  public readonly data = inject<AddCreatorDialogData>(NZ_MODAL_DATA);

  public readonly candidates = signal<CreatorSearchItem[]>([]);

  public readonly searchLoading = signal(false);

  public readonly saving = signal(false);

  public creatorID = '';

  public readonly dontFilter = () => true;

  private readonly q$ = new Subject<string>();

  public constructor() {
    this.q$
      .pipe(
        debounceTime(250),
        distinctUntilChanged(),
        switchMap((q) => {
          if (q.trim().length < 2) return of<{ items: CreatorSearchItem[] }>({ items: [] });
          this.searchLoading.set(true);
          return this.http
            .get<{ items: CreatorSearchItem[] }>(`${this.apiBase}/manager/users/search`, {
              params: { q, kind: 'specialist' },
            })
            .pipe(catchError(() => of({ items: [] as CreatorSearchItem[] })));
        }),
      )
      .subscribe((r) => {
        this.searchLoading.set(false);
        this.candidates.set(r.items ?? []);
      });
  }

  public onSearch(q: string): void {
    this.q$.next(q);
  }

  public formatLabel(u: CreatorSearchItem): string {
    return [u.display_name, u.email, u.phone].filter(Boolean).join(' · ');
  }

  public cancel(): void {
    this.modalRef.destroy();
  }

  public submit(): void {
    if (!this.creatorID) {
      this.msg.error('Выберите креатора.');
      return;
    }
    this.saving.set(true);
    this.api
      .managerAddCreator(this.data.projectID, this.creatorID)
      .pipe(
        catchError((e) => {
          this.saving.set(false);
          // not_a_creator — не специалист либо аккаунт отключён. Текст у
          // бэка внятный, свой не сочиняем.
          this.msg.error(parseApiError(e, 'Не удалось добавить креатора.').message);
          return EMPTY;
        }),
      )
      .subscribe(() => {
        this.saving.set(false);
        this.msg.success('Креатор добавлен в проект');
        this.modalRef.destroy(this.creatorID);
      });
  }
}
