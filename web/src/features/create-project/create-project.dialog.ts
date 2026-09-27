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
import { NzCheckboxModule } from 'ng-zorro-antd/checkbox';
import { NzMessageService } from 'ng-zorro-antd/message';
import { panelData, panelRef } from '@shared/lib/panel';
import {
  catchError,
  debounceTime,
  distinctUntilChanged,
  EMPTY,
  of,
  Subject,
  switchMap,
} from 'rxjs';

import { API_URL } from '@shared/api/api-url.token';
import { ProjectApi, CreateProjectPayload } from '@entities/project/api/project.api';
import { ProjectKind } from '@entities/project/model/project.types';

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
    NzCheckboxModule,
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
          [nzNotFoundContent]="
            clientCandidates().length ? 'Нет совпадений' : 'Начните печатать (мин 2 символа)'
          "
        >
          @for (u of clientCandidates(); track u.user_id) {
            <nz-option [nzValue]="u.user_id" [nzLabel]="formatUserLabel(u)"></nz-option>
          }
        </nz-select>
      }

      <label>Название проекта</label>
      <input
        nz-input
        [(ngModel)]="title"
        name="t"
        placeholder="Промо-ролик к запуску"
        data-test="create-project-title"
      />
      <!-- Подсказка стоит сразу, а не появляется после отказа: правило
           короткое, и узнавать о нём из ошибки незачем. -->
      <span class="hint">Минимум 3 символа — по «12345» проект потом не найти.</span>

      <label>Вид проекта</label>
      <div class="kinds">
        @for (k of kinds; track k.value) {
          <button type="button" class="kind" [class.on]="kind === k.value" (click)="kind = k.value">
            <b>{{ k.title }}</b>
            <span>{{ k.hint }}</span>
          </button>
        }
      </div>

      <label>Бюджет (опционально, ₽)</label>
      <nz-input-number
        [(ngModel)]="budget"
        name="b"
        [nzMin]="0"
        style="width: 100%"
      ></nz-input-number>

      <label>Заметки (бриф/детали)</label>
      <textarea
        nz-input
        rows="3"
        [(ngModel)]="notes"
        name="nt"
        placeholder="Что хочет клиент, дедлайны, бюджет"
      ></textarea>

      <!-- Тестовые проекты копятся на стенде и забивают админский список.
           Отметка здесь — единственный способ их отличить: по названию
           («тест т8т 1234») это делалось на глаз. -->
      <label
        nz-checkbox
        [(ngModel)]="isTest"
        name="it"
        class="test-flag"
        data-test="create-project-is-test"
        >Тестовый проект — прятать из общего списка</label
      >

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
      .hint {
        font-size: 11px;
        color: var(--text-muted);
      }
      .test-flag {
        margin-top: 12px;
      }
      /* Вид проекта — карточками, а не выпадашкой: их три, и от выбора
         зависит вся дальнейшая работа с проектом. */
      .kinds {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
        gap: 8px;
        margin-top: 2px;
      }
      .kind {
        display: flex;
        flex-direction: column;
        gap: 3px;
        padding: 11px 13px;
        border: 1px solid var(--border-strong, #2c313a);
        border-radius: var(--r-field, 10px);
        background: var(--bg-elevated, #111316);
        color: var(--text);
        font: inherit;
        text-align: left;
        cursor: pointer;
      }
      .kind b {
        font-size: 14px;
      }
      .kind span {
        color: var(--text-muted);
        font-size: 12px;
        line-height: 1.4;
      }
      .kind.on {
        border-color: var(--cta, #f0553c);
        background: rgba(240, 85, 60, 0.1);
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
  // Окно на десктопе, нижняя шторка на телефоне — см. shared/lib/panel.
  private readonly panel = panelRef();

  private readonly api = inject(ProjectApi);

  private readonly http = inject(HttpClient);

  private readonly apiBase = inject(API_URL);

  private readonly msg = inject(NzMessageService);

  private readonly router = inject(Router);

  public readonly data = panelData<DialogData>();

  // Вид проекта решает всё остальное: у креаторов и у бренда вместо
  // воронки план выкладок, у продакшна — шаги, у общего проекта один
  // срок сдачи. Воронку здесь больше не выбирают: её ставят внутри
  // проекта.
  public readonly kinds: ReadonlyArray<{ value: ProjectKind; title: string; hint: string }> = [
    {
      value: 'creators_turnkey',
      title: 'Креаторы под ключ',
      hint: 'План выкладок, состав креаторов, начисления по просмотрам',
    },
    {
      value: 'brand_turnkey',
      title: 'Бренд под ключ',
      hint: 'План выкладок с аккаунтов бренда, без креаторов и начислений',
    },
    {
      value: 'production_turnkey',
      title: 'Продакшен под ключ',
      hint: 'Съёмка и монтаж по шагам воронки',
    },
    {
      value: 'general',
      title: 'Общий проект',
      hint: 'Один срок и сдача материалов, без шагов',
    },
  ];

  public readonly saving = signal(false);

  public readonly clientCandidates = signal<UserSearchItem[]>([]);

  public readonly clientSearchLoading = signal(false);

  public clientMode: 'no_account' | 'registered' = 'no_account';
  public clientUserID = '';
  public clientName = '';
  public clientContact = '';
  public title = '';
  public kind: ProjectKind = 'creators_turnkey';
  public isTest = false;
  public notes = '';
  public budget: number | null = null;

  // NzSelect фильтрует своими силами по nzLabel — это плохо для server-search.
  // Выключаем: возвращаем все результаты как есть, бек уже отфильтровал.
  public readonly dontFilter = () => true;

  private readonly clientQ$ = new Subject<string>();

  public constructor() {
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
            .get<{
              items: UserSearchItem[];
            }>(`${this.apiBase}/manager/users/search`, { params: { q, kind: 'client' } })
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
    this.panel.close();
  }

  public submit(): void {
    // trim до проверки: «   ы   » — это одна буква, а не пять символов.
    // Ту же границу держит сервер; здесь она экономит круг до него.
    const t = this.title.trim();
    if (t.length < 3) {
      this.msg.error('Название проекта — минимум 3 символа.');
      return;
    }
    const payload: CreateProjectPayload = {
      kind: this.kind,
      title: t,
      notes: this.notes.trim(),
    };
    if (this.isTest) payload.is_test = true;
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
    const req =
      this.data.mode === 'admin'
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
        this.panel.close(created);
        // Отдельной /admin/projects/:id страницы нет — manager-project-detail
        // пропускает admin через requireRole('manager','admin'). Используем
        // его для обоих режимов. Раньше admin-mode шёл на несуществующий
        // /admin/projects/<uuid> → router падал в wildcard → юзера выкидывало
        // на главную.
        void this.router.navigate(['/manager/projects', created.id]);
      });
  }
}
