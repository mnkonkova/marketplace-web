import { Injectable, inject, signal } from '@angular/core';

import { parseApiError } from '@shared/api/api-error';

import { AdminApi } from '../api/admin.api';
import { AdminSummary } from './admin-shell.types';

/**
 * Сводка — один запрос на весь заход в админку.
 *
 * Её просят двое: экран `/admin` рисует «Требует внимания», ветки,
 * нагрузку и журнал, а сайдбар берёт из неё счётчики разделов. Просить
 * одно и то же дважды при каждом открытии админки — плата ни за что,
 * поэтому ответ живёт здесь, а оба потребителя зовут `ensure()`.
 *
 * `ensure()` идемпотентен: пока запрос в полёте, второй вызов ничего не
 * шлёт. `reload()` — явное «пересчитать», после действия, которое сводку
 * меняет (взяли проект, одобрили профиль).
 */
@Injectable({ providedIn: 'root' })
export class AdminSummaryStore {
  private readonly api = inject(AdminApi);

  public readonly data = signal<AdminSummary | null>(null);

  public readonly loading = signal(false);

  public readonly error = signal<string | null>(null);

  private inFlight = false;

  /** Загрузить, если ещё не загружали и не грузим прямо сейчас. */
  public ensure(): void {
    if (this.data() || this.inFlight) return;
    this.fetch();
  }

  public reload(): void {
    if (this.inFlight) return;
    this.fetch();
  }

  private fetch(): void {
    this.inFlight = true;
    this.loading.set(true);
    this.error.set(null);
    this.api.summary().subscribe({
      next: (s) => {
        this.data.set(s);
        this.loading.set(false);
        this.inFlight = false;
      },
      error: (e) => {
        this.loading.set(false);
        this.inFlight = false;
        // 403 — сводка админская; менеджеру её не показывают, и молчать
        // здесь правильнее, чем рисовать ему ошибку чужого экрана.
        const parsed = parseApiError(e, 'Не удалось собрать сводку.');
        this.error.set(parsed.status === 403 ? null : parsed.message);
      },
    });
  }
}
