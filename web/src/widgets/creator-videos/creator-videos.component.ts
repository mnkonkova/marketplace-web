import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { NzMessageService } from 'ng-zorro-antd/message';

import { groupDigits, signedDigits } from '@entities/billing/lib/money';
import { PublicationApi } from '@entities/publication/api/publication.api';
import { collectErrorLabel } from '@entities/publication/lib/collect-error';
import {
  buildVideoMatrix,
  heat,
  MatrixCell,
  summarize,
} from '@entities/publication/lib/video-matrix';
import { PLATFORM_LABEL, PLATFORM_SHORT } from '@entities/publication/lib/publication-status';
import type {
  Platform,
  Publication,
  PublicationReport,
  SubmittedLink,
} from '@entities/publication/model/publication.types';
import { parseApiError } from '@shared/api/api-error';
import { ErValueComponent } from '@shared/ui/er-value/er-value.component';

/** Вышедший ролик, как его отдаёт страница: с подписью и отметкой проверки. */
export interface CreatorVideoItem {
  pub: Publication;
  title: string;
  review?: { label: string; tone: string };
}

type CellKind = 'none' | 'pending' | 'failed' | 'ok';

interface Cell {
  platform: Platform;
  kind: CellKind;
  url: string;
  text: string;
  sub: string;
  title: string;
  // 0…1 — доля акцентного цвета в фоне: та же шкала, что у менеджера.
  heat: number;
}

// Вышедшие ролики креатора — той же таблицей «ролик × площадка», что у
// менеджера: просмотры каждого ролика на каждой площадке и итог по
// площадкам. Только свои — отчёт креатору сервер режет по нему.
//
// Цифры считает та же логика, что у менеджера (buildVideoMatrix):
// у одного ролика в двух кабинетах не может быть двух разных чисел.
// Пустая клетка — не ноль: ссылки нет, собираем или площадка отказала.
@Component({
  selector: 'app-creator-videos',
  standalone: true,
  imports: [CommonModule, FormsModule, ErValueComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './creator-videos.component.html',
  styleUrls: ['./creator-videos.component.scss'],
})
export class CreatorVideosComponent {
  private readonly api = inject(PublicationApi);

  private readonly msg = inject(NzMessageService);

  public readonly items = input<CreatorVideoItem[]>([]);

  public readonly report = input<PublicationReport | null>(null);

  /** Площадки проекта — колонки таблицы. */
  public readonly platforms = input<readonly Platform[]>([]);

  /** Ссылка заменена или добавлена — странице пора перечитать данные. */
  public readonly changed = output<void>();

  public readonly platformLabel = PLATFORM_LABEL;

  public readonly platformShort = PLATFORM_SHORT;

  /**
   * Порядок. «Новые» — по умолчанию: креатор открывает список спросить
   * про вчерашний ролик. «По просмотрам» — когда разбирается, что заходит.
   */
  public readonly sort = signal<'date' | 'views'>('date');

  private readonly best = computed(() => Math.max(0, ...this.items().map((i) => i.pub.views)));

  /** Таблица по своим роликам — тем же расчётом, что у менеджера. */
  private readonly matrix = computed(() =>
    buildVideoMatrix(
      this.items().map((i) => i.pub),
      this.report()?.videos_table ?? [],
    ),
  );

  private readonly maxViews = computed(() => {
    let max = 0;
    for (const v of this.matrix().videos) {
      for (const c of Object.values(v.cells)) if (c.kind === 'ok' && c.views > max) max = c.views;
    }
    return max;
  });

  public readonly rows = computed(() => {
    const best = this.best();
    const max = this.maxViews();
    const byId = new Map(this.matrix().videos.map((v) => [v.publicationId, v] as const));
    const list = this.items().map((it) => {
      const v = byId.get(it.pub.id);
      return {
        ...it,
        cells: this.platforms().map((pl) => this.cell(it.pub, pl, v?.cells[pl], max)),
        views: groupDigits(it.pub.views),
        growth: v ? v.growth : null,
        bar: best && it.pub.views ? Math.max(2, Math.round((it.pub.views / best) * 100)) : 0,
        isBest: it.pub.views > 0 && it.pub.views === best,
        date: it.pub.published_at ?? it.pub.due_date,
      };
    });
    return this.sort() === 'views' ? [...list].sort((a, b) => b.pub.views - a.pub.views) : list;
  });

  /** Итог по площадкам — нижняя строка таблицы. */
  public readonly totals = computed(() => {
    const t = summarize(this.matrix().videos);
    const by = new Map(t.totals.map((p) => [p.platform, p] as const));
    return {
      cells: this.platforms().map((pl) => {
        const p = by.get(pl);
        return {
          platform: pl,
          // Сданные ссылки без единого снимка — прочерк, а не ноль:
          // сборщик по ним отказал, и ноль сказал бы креатору, что его
          // ролик на этой площадке не посмотрел никто.
          text: p?.measured ? groupDigits(p.views) : '—',
          links: p?.links ?? 0,
        };
      }),
      views: groupDigits(t.views),
      growth: t.growth === null ? '' : signedDigits(t.growth) + ' за сутки',
    };
  });

  private cell(pub: Publication, pl: Platform, c: MatrixCell | undefined, max: number): Cell {
    const base = { platform: pl, url: '', title: '', sub: '', heat: 0 };
    if (!c || c.kind === 'none') return { ...base, kind: 'none', text: 'нет ссылки' };
    if (c.kind === 'pending') return { ...base, kind: 'pending', url: c.url, text: 'собираем' };
    if (c.kind === 'failed') {
      // Подпись — для глаз, исходный ответ сборщика — в подсказке.
      return {
        ...base,
        kind: 'failed',
        url: c.url,
        text: collectErrorLabel(c.reason),
        title: c.reason,
      };
    }
    return {
      ...base,
      kind: 'ok',
      url: c.url,
      text: groupDigits(c.views),
      sub: c.growth === null ? 'первый замер' : signedDigits(c.growth),
      heat: heat(c.views, max),
    };
  }

  public label(pl: Platform): string {
    return this.platformLabel[pl];
  }

  // ---- ссылки ролика ----

  /**
   * Можно ли креатору править ссылки этой выкладки. Закрытую менеджером
   * сервер не принимает («выкладка закрыта — досылать ссылки нельзя»):
   * предлагать там «Добавить» значило бы вести в отказ.
   */
  public canEdit(pub: Publication): boolean {
    return pub.status !== 'closed_manually' && pub.status !== 'cancelled';
  }

  /** Чей ролик раскрыт для правки ссылок. Один за раз. */
  public readonly openLinks = signal('');

  public toggleLinks(pubId: string): void {
    this.openLinks.set(this.openLinks() === pubId ? '' : pubId);
    this.editing.set('');
  }

  public link(pub: Publication, pl: Platform): SubmittedLink | undefined {
    return pub.links.find((l) => l.platform === pl);
  }

  public readonly editing = signal('');

  public editUrl = '';

  public readonly busy = signal(false);

  public isEditing(pub: Publication, pl: Platform): boolean {
    return this.editing() === `${pub.id}|${pl}`;
  }

  public startEdit(pub: Publication, pl: Platform): void {
    this.openLinks.set(pub.id);
    this.editUrl = this.link(pub, pl)?.url ?? '';
    this.editing.set(`${pub.id}|${pl}`);
  }

  public cancelEdit(): void {
    this.editing.set('');
  }

  /**
   * Заменить или дослать ссылку. Снять ссылку креатор не может — это
   * решение менеджера о работе (CreatorEditLink в API), поэтому пустое
   * поле просто не сохраняется.
   */
  public save(pub: Publication, pl: Platform): void {
    const url = this.editUrl.trim();
    if (!url || this.busy()) return;
    const had = !!this.link(pub, pl);
    this.busy.set(true);
    this.api.creatorEditLink(pub.id, pl, url).subscribe({
      next: () => {
        this.busy.set(false);
        this.editing.set('');
        this.msg.success(had ? 'Ссылка заменена.' : 'Ссылка добавлена.');
        this.changed.emit();
      },
      error: (e) => {
        this.busy.set(false);
        this.msg.error(parseApiError(e, 'Не удалось сохранить ссылку.').message);
      },
    });
  }
}
