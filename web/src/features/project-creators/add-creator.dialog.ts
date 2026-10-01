import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzMessageService } from 'ng-zorro-antd/message';
import { NzSelectModule } from 'ng-zorro-antd/select';
import { panelData, panelRef } from '@shared/lib/panel';
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
import { PrMarketAvaComponent } from '@shared/ui/prmarket-ava/prmarket-ava.component';

interface CreatorSearchItem {
  user_id: string;
  email?: string;
  phone?: string;
  display_name?: string;
  kind: string;
  /** Лицо в списке: состав набирают, узнавая людей, а не читая почты. */
  avatar_url?: string;
  /**
   * Сколько просмотров человек обычно даёт за ролик. Медиана, а не
   * среднее. Приходит только у тех, кто роликов сдал достаточно, чтобы
   * число что-то значило.
   */
  median?: { views: number; basis: number };
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
  imports: [CommonModule, FormsModule, NzSelectModule, NzButtonModule, PrMarketAvaComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <form class="form" (submit)="$event.preventDefault(); submit()">
      <label>Найти креатора (имя / email / телефон / id)</label>
      <nz-select
        [(ngModel)]="creatorID"
        name="c"
        nzPlaceHolder="Имя, почта, телефон или id"
        nzShowSearch
        nzServerSearch
        nzDropdownClassName="cand-dd"
        [nzOptionHeightPx]="optionHeight"
        [nzShowArrow]="false"
        [nzFilterOption]="dontFilter"
        (nzOnSearch)="onSearch($event)"
        [nzLoading]="searchLoading()"
        [nzNotFoundContent]="
          candidates().length ? 'Нет совпадений' : 'Начните печатать (мин 2 символа)'
        "
      >
        <!-- Своя разметка строки, а не одна подпись: человека узнают в
             лицо, и аватарка отвечает на «тот ли это» быстрее, чем
             почта. Подпись при этом остаётся — по ней ng-zorro рисует
             выбранное и по ней же читает экранный диктор. -->
        @for (u of candidates(); track u.user_id) {
          <nz-option [nzValue]="u.user_id" [nzLabel]="formatLabel(u)" nzCustomContent>
            <span class="cand">
              <app-prmarket-ava [name]="nameOf(u)" [src]="u.avatar_url" [size]="28" />
              <span class="cand-t">
                <b>{{ nameOf(u) }}</b>
                <small>{{ subtitle(u) }}</small>
              </span>
            </span>
          </nz-option>
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
      .cand {
        display: flex;
        align-items: center;
        gap: 10px;
        /* Строка выше одной текстовой: в неё помещается лицо, и
           попасть по ней пальцем становится возможно. */
        padding: 2px 0;
      }
      .cand-t {
        display: flex;
        flex-direction: column;
        min-width: 0;
        line-height: 1.25;
      }
      .cand-t small {
        color: var(--text-muted);
        font-size: 11.5px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
    `,
  ],
})
export class AddCreatorDialogComponent {
  // Окно на десктопе, нижняя шторка на телефоне — см. shared/lib/panel.
  private readonly panel = panelRef();

  private closeWith(result?: unknown): void {
    this.panel.close(result);
  }

  private readonly api = inject(PublicationApi);

  private readonly http = inject(HttpClient);

  private readonly apiBase = inject(API_URL);

  private readonly msg = inject(NzMessageService);

  public readonly data = panelData<AddCreatorDialogData>();

  public readonly candidates = signal<CreatorSearchItem[]>([]);

  public readonly searchLoading = signal(false);

  public readonly saving = signal(false);

  public creatorID = '';

  public readonly dontFilter = () => true;

  /**
   * Высота строки списка.
   *
   * Список виртуализирован: ng-zorro раскладывает строки по
   * фиксированной мерке и ею же режет содержимое, сколько ни задавай
   * высоту в стилях. В строке у нас лицо и две подписи — имя и
   * «почта · медиана», — и в стандартные 32 px вторая не помещалась,
   * обрезаясь ровно посередине.
   */
  public readonly optionHeight = 48;

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

  /**
   * Подпись кандидата.
   *
   * Медиана здесь не украшение: креатора выбирают по тому, сколько он
   * обычно даёт, и список из одних почт — это выбор вслепую.
   */
  public formatLabel(u: CreatorSearchItem): string {
    const parts = [this.nameOf(u), this.subtitle(u)].filter(Boolean);
    return parts.join(' · ');
  }

  /** Как человека зовут. Без имени — почта, без почты — начало id. */
  public nameOf(u: CreatorSearchItem): string {
    return u.display_name || u.email || u.phone || u.user_id.slice(0, 8);
  }

  /**
   * Вторая строка: по чему его узнают и сколько он обычно даёт.
   *
   * Медиана здесь не украшение: креатора выбирают по тому, сколько он
   * обычно даёт, и список из одних почт — это выбор вслепую.
   */
  public subtitle(u: CreatorSearchItem): string {
    const parts: string[] = [];
    if (u.display_name && u.email) parts.push(u.email);
    if (u.phone) parts.push(u.phone);
    if (u.median) parts.push(`медиана ${this.shortViews(u.median.views)}`);
    // Когда опознать больше нечем — начало идентификатора: по нему
    // сюда и пришли, если искали по нему.
    if (!parts.length) parts.push(u.user_id.slice(0, 8));
    return parts.join(' · ');
  }

  private shortViews(v: number): string {
    if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1).replace('.', ',')} млн`;
    if (v >= 1_000) return `${Math.round(v / 1_000)} тыс.`;
    return String(v);
  }

  public cancel(): void {
    this.closeWith();
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
        this.closeWith(this.creatorID);
      });
  }
}
