import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  HostListener,
  computed,
  effect,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { Router } from '@angular/router';
import { Subject, debounceTime, distinctUntilChanged, switchMap } from 'rxjs';
import { catchError, of } from 'rxjs';

import { AdminApi } from '@entities/admin/api/admin.api';
import { SearchProjectHit, SearchUserHit } from '@entities/admin/model/admin-shell.types';
import { PROJECT_KIND_LABEL } from '@shared/lib/project-status';
import { CrmIconComponent } from '@shared/ui/crm-icon/crm-icon.component';

import { CrmSearchStore } from './crm-search.store';

/** Строка выдачи: проект или человек, но ведут они в разные места. */
interface Hit {
  kind: 'project' | 'user';
  id: string;
  title: string;
  note: string;
}

/**
 * Поиск по CRM — ⌘K.
 *
 * Админка выросла до десяти разделов, и дорога к конкретному проекту или
 * человеку шла через раздел, фильтр и страницу списка. Поиск сокращает её
 * до двух нажатий — но только если не отнимает того, что уже было: фокус
 * возвращается туда, откуда открыли, Escape закрывает, стрелки и Enter
 * водят по выдаче, не трогая мышь.
 */
@Component({
  selector: 'app-crm-search',
  standalone: true,
  imports: [CrmIconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './crm-search.component.html',
  styleUrl: './crm-search.component.scss',
})
export class CrmSearchComponent {
  private readonly api = inject(AdminApi);

  private readonly router = inject(Router);

  private readonly store = inject(CrmSearchStore);

  public readonly open = this.store.open;

  public readonly q = signal('');

  public readonly loading = signal(false);

  public readonly projects = signal<SearchProjectHit[]>([]);

  public readonly users = signal<SearchUserHit[]>([]);

  /** Куда показывает клавиатура. -1 — ни на что: ещё не жали стрелку. */
  public readonly cursor = signal(-1);

  private readonly input = viewChild<ElementRef<HTMLInputElement>>('field');

  private readonly q$ = new Subject<string>();

  /** Единый плоский список: по нему ходят стрелки, он же нумерует выдачу. */
  public readonly hits = computed<Hit[]>(() => [
    ...this.projects().map((p) => ({
      kind: 'project' as const,
      id: p.id,
      title: p.title,
      note: [PROJECT_KIND_LABEL[p.kind as keyof typeof PROJECT_KIND_LABEL] ?? p.kind, p.client_name]
        .filter(Boolean)
        .join(' · '),
    })),
    ...this.users().map((u) => ({
      kind: 'user' as const,
      id: u.id,
      title: u.display_name || u.email || u.id,
      note: u.is_admin
        ? 'админ'
        : u.is_manager
          ? 'менеджер'
          : u.kind === 'client'
            ? 'клиент'
            : 'специалист',
    })),
  ]);

  public readonly empty = computed(
    () => !this.loading() && this.q().trim().length >= 2 && this.hits().length === 0,
  );

  public constructor() {
    this.q$
      .pipe(
        debounceTime(220),
        distinctUntilChanged(),
        switchMap((q) => {
          // Короче двух символов ручка всё равно не ищет — не шлём.
          if (q.trim().length < 2) {
            this.loading.set(false);
            return of({ projects: [], users: [] });
          }
          this.loading.set(true);
          return this.api.globalSearch(q.trim()).pipe(
            // Поиск — вспомогательный ход: упавший запрос не должен
            // закрывать панель и не заслуживает красной плашки.
            catchError(() => of({ projects: [], users: [] })),
          );
        }),
      )
      .subscribe((r) => {
        this.projects.set(r.projects ?? []);
        this.users.set(r.users ?? []);
        this.cursor.set(-1);
        this.loading.set(false);
      });

    effect(() => {
      if (!this.open()) return;
      // Каждое открытие — чистый лист: прошлый запрос уже не про то,
      // зачем панель открыли сейчас.
      this.q.set('');
      this.projects.set([]);
      this.users.set([]);
      this.cursor.set(-1);
      queueMicrotask(() => this.input()?.nativeElement.focus());
    });
  }

  public onInput(value: string): void {
    this.q.set(value);
    this.q$.next(value);
  }

  public close(): void {
    // Фокус возвращается туда, откуда открыли (см. CrmSearchStore).
    const back = this.store.hide();
    queueMicrotask(() => back?.focus());
  }

  @HostListener('document:keydown', ['$event'])
  public onKey(e: KeyboardEvent): void {
    // ⌘K / Ctrl+K открывает из любого места CRM, включая поля ввода:
    // сочетание занято только браузерной строкой поиска, и перехват тут
    // — то, чего от него и ждут.
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      if (this.open()) {
        this.close();
        return;
      }
      this.store.show(document.activeElement);
      return;
    }
    if (!this.open()) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      this.close();
      return;
    }
    const n = this.hits().length;
    if (!n) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      this.cursor.set((this.cursor() + 1) % n);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      this.cursor.set((this.cursor() - 1 + n) % n);
    } else if (e.key === 'Enter') {
      const i = this.cursor();
      if (i >= 0 && i < n) {
        e.preventDefault();
        this.go(this.hits()[i]);
      }
    }
  }

  public go(hit: Hit): void {
    this.close();
    if (hit.kind === 'project') {
      void this.router.navigate(['/manager/projects', hit.id]);
    } else {
      // Человек открывается карточкой поверх списка пользователей: своей
      // страницы у него нет, а карточка — это и есть «посмотреть человека».
      void this.router.navigate(['/admin/users'], { queryParams: { person: hit.id } });
    }
  }
}
