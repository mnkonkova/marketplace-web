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
  PLATFORM_COLOR,
  PLATFORM_LABEL,
  PLATFORM_SHORT,
} from '@entities/publication/lib/publication-status';
import {
  buildVideoMatrix,
  cellValue,
  heat,
  MatrixCell,
  MatrixMetric,
  matrixMax,
  MatrixTotals,
  MatrixVideo,
  summarize,
} from '@entities/publication/lib/video-matrix';
import {
  ALL_PLATFORMS,
  Platform,
  Publication,
  PublicationReport,
  SubmittedLink,
} from '@entities/publication/model/publication.types';
import { parseApiError } from '@shared/api/api-error';
import { ErValueComponent } from '@shared/ui/er-value/er-value.component';

/** Клетка, готовая к показу: текст, подпись и насыщенность. */
interface ShownCell {
  platform: Platform;
  kind: MatrixCell['kind'];
  text: string;
  sub: string;
  url: string;
  title: string;
  // 0…1 — доля акцентного цвета в фоне клетки.
  heat: number;
  // ER клетки и признак «без репостов» — для app-er-value в режиме ER.
  erPct: number | null;
  erPartial: boolean;
}

// Ролики проекта по площадкам — только для менеджера.
//
// «Какая площадка тянет» в блоке статистики отвечает про каналы в
// целом, «кто сколько набрал» — про людей. Ни один из них не отвечает
// на вопрос, с которым менеджер приходит чаще всего: как идёт ВОТ ЭТОТ
// ролик и где он не набирает. До этой таблицы цифры ролика по площадкам
// лежали в свёрнутом списке ссылок, а на телефоне их не было вовсе.
//
// Креатор видит такую же таблицу по своим роликам (app-creator-videos).
//
// Ссылки ролика правятся здесь же, а не отдельным блоком «Ссылки на
// ролики»: менеджер замечает битую ссылку именно по клетке без цифр, и
// идти чинить её в другой конец страницы — лишний шаг, на котором её
// забывают.
@Component({
  selector: 'app-video-matrix',
  standalone: true,
  imports: [CommonModule, FormsModule, ErValueComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './video-matrix.component.html',
  styleUrls: ['./video-matrix.component.scss'],
})
export class VideoMatrixComponent {
  private readonly api = inject(PublicationApi);

  private readonly msg = inject(NzMessageService);

  public readonly publications = input<Publication[]>([]);

  /** Ссылка заменена или добавлена — карточке пора перечитать данные. */
  public readonly changed = output<void>();

  public readonly report = input<PublicationReport | null>(null);

  public readonly platforms = ALL_PLATFORMS;

  public readonly platformLabel = PLATFORM_LABEL;

  public readonly platformShort = PLATFORM_SHORT;

  public readonly metrics: { key: MatrixMetric; title: string }[] = [
    { key: 'views', title: 'Просмотры' },
    { key: 'growth', title: 'За сутки' },
    { key: 'er', title: 'ER' },
  ];

  /**
   * Что показывать в клетках. Просмотры по умолчанию: «сколько набрал»
   * спрашивают первым, а прирост и ER — уже разбираясь, почему так.
   */
  public readonly metric = signal<MatrixMetric>('views');

  /**
   * Сколько карточек на телефоне. Роликов за месяц бывает тридцать, и
   * лента из тридцати карточек по шесть строк — это не обзор, а свиток.
   */
  public readonly phoneLimit = signal(5);

  public readonly matrix = computed(() =>
    buildVideoMatrix(this.publications(), this.report()?.videos_table ?? []),
  );

  /**
   * Креаторы проекта по роликам таблицы, самый результативный первым.
   *
   * Креаторов в проекте бывает несколько, и итог «по всем» отвечает про
   * проект, а не про человека: решение «звать ли его в следующий месяц»
   * принимают по итогу самого креатора.
   */
  public readonly creators = computed(() => {
    const by = new Map<string, { id: string; name: string; views: number }>();
    for (const v of this.matrix().videos) {
      if (!v.creatorUserId) continue;
      const c = by.get(v.creatorUserId) ?? {
        id: v.creatorUserId,
        name: v.creatorName || 'Без имени',
        views: 0,
      };
      c.views += v.views;
      by.set(v.creatorUserId, c);
    }
    return [...by.values()].sort((x, y) => y.views - x.views);
  });

  /** Чьи ролики показывать: '' — всех. */
  public readonly creatorFilter = signal('');

  public setCreator(id: string): void {
    this.creatorFilter.set(id);
    this.openLinks.set('');
  }

  private readonly shownVideos = computed(() => {
    const id = this.creatorFilter();
    const all = this.matrix().videos;
    return id ? all.filter((v) => v.creatorUserId === id) : all;
  });

  /** Итоги того, что показано: проекта целиком или одного креатора. */
  private readonly scope = computed(() => summarize(this.shownVideos()));

  /** Подпись сводки площадок: по чьим роликам она посчитана. */
  public readonly scopeSub = computed(() => {
    const id = this.creatorFilter();
    if (!id) return 'сумма по всем роликам';
    return 'ролики: ' + (this.creators().find((c) => c.id === id)?.name ?? '');
  });

  /** Подпись нижней строки: чей это итог. */
  public readonly scopeTitle = computed(() => {
    const id = this.creatorFilter();
    if (id) return 'Итого: ' + (this.creators().find((c) => c.id === id)?.name ?? '');
    return this.creators().length > 1 ? 'Итого по всем' : 'Итого';
  });

  private readonly max = computed(() => matrixMax({ videos: this.shownVideos() }, this.metric()));

  private toRow(v: MatrixVideo, metric: MatrixMetric, max: number) {
    return {
      ...v,
      shown: this.platforms.map((pl) => this.show(pl, v.cells[pl], metric, max)),
      totalText: v.measured
        ? this.fmt(metric, metric === 'views' ? v.views : metric === 'growth' ? v.growth : v.er)
        : '—',
      totalSub: this.totalSub(metric, v),
      erPct: v.er,
      erPartial: v.erPartial,
      // Полоска площадки на телефоне — от лучшей площадки этого ролика.
      best: Math.max(0, ...this.platforms.map((pl) => cellValue(v.cells[pl], 'views') ?? 0)),
    };
  }

  public readonly rows = computed(() => {
    const metric = this.metric();
    const max = this.max();
    return this.shownVideos().map((v) => this.toRow(v, metric, max));
  });

  /**
   * Строки таблицы, разложенные по креаторам, с итогом каждого.
   *
   * Группы — только когда смотрят всех и креаторов больше одного: у
   * одного человека итог группы совпал бы с итогом по всем, и строка
   * повторилась бы дважды подряд.
   */
  public readonly groups = computed(() => {
    const rows = this.rows();
    const metric = this.metric();
    const people = this.creators();
    if (this.creatorFilter() || people.length < 2) {
      return [{ key: 'all', title: '', rows, subtotal: null }];
    }
    const groups = people.map((c) => {
      const mine = rows.filter((r) => r.creatorUserId === c.id);
      return {
        key: c.id,
        title: 'Итого: ' + c.name,
        rows: mine,
        subtotal: this.totalsRow(summarize(mine), metric, mine.length),
      };
    });
    // Ролики без автора (у смешанного проекта) — своей группой в конце.
    const orphans = rows.filter((r) => !r.creatorUserId);
    if (orphans.length) {
      groups.push({
        key: 'none',
        title: 'Итого: ролики проекта',
        rows: orphans,
        subtotal: this.totalsRow(summarize(orphans), metric, orphans.length),
      });
    }
    return groups;
  });

  public readonly phoneRows = computed(() => this.rows().slice(0, this.phoneLimit()));

  public readonly footer = computed(() =>
    this.totalsRow(this.scope(), this.metric(), this.shownVideos().length),
  );

  private totalsRow(t: MatrixTotals, metric: MatrixMetric, count: number) {
    return {
      count,
      cells: t.totals.map((p) => ({
        platform: p.platform,
        // Нечего считать — прочерк, а не ноль. Ноль читался бы как
        // «выложили, и никто не посмотрел».
        //
        // «Нечего» — это два разных случая, и оба здесь: ни одной
        // ссылки на площадке и ни одного снимка по сданным ссылкам.
        // Второй дороже: сборщик отказал по всем трём ссылкам, сумма
        // сложилась из трёх нулей, и в итоговой строке стоял честный на
        // вид ноль — по нему менеджер объяснял заказчику, что площадка
        // не работает, хотя на деле не работал сбор.
        text: p.measured
          ? this.fmt(metric, metric === 'views' ? p.views : metric === 'growth' ? p.growth : p.er)
          : '—',
        links: p.links,
        erPct: p.measured ? p.er : null,
        erPartial: p.erPartial,
      })),
      grand: t.measured
        ? this.fmt(metric, metric === 'views' ? t.views : metric === 'growth' ? t.growth : t.er)
        : '—',
      grandEr: t.er,
      grandErPartial: t.erPartial,
    };
  }

  /**
   * Какая площадка тянет: сумма по показанным роликам, лучшая сверху.
   *
   * Стоит над таблицей, а не отдельным блоком статистики: это итог той
   * же таблицы по столбцам, и разводить их значило бы держать два
   * ответа на один вопрос в разных местах страницы.
   */
  public readonly summary = computed(() => {
    const m = this.scope();
    const best = Math.max(0, ...m.totals.map((t) => t.views));
    return (
      [...m.totals]
        // Площадка без единого снимка тянуть не может: в сводке она
        // стояла бы с нулём просмотров и долей «0,0%», то есть говорила
        // бы «тут не смотрят» вместо «тут не собралось». Что со сбором
        // не так, отвечает таблица ниже — там у клетки стоит причина.
        .filter((t) => t.measured > 0)
        .sort((x, y) => y.views - x.views)
        .map((t) => ({
          platform: t.platform,
          views: groupDigits(t.views),
          share: m.views ? ((t.views / m.views) * 100).toFixed(1).replace('.', ',') + '%' : '—',
          growth: t.growth === null ? 'первый замер' : signedDigits(t.growth),
          er: t.er,
          erPartial: t.erPartial,
          bar: best ? Math.max(1, Math.round((t.views / best) * 100)) : 0,
          color: PLATFORM_COLOR[t.platform],
        }))
    );
  });

  // ---- ссылки ролика ----

  private readonly pubById = computed(
    () => new Map(this.publications().map((p) => [p.id, p] as const)),
  );

  /** Чей ролик раскрыт для правки ссылок. Один за раз: два открытых путаются. */
  public readonly openLinks = signal('');

  public toggleLinks(pubId: string): void {
    this.openLinks.set(this.openLinks() === pubId ? '' : pubId);
    this.editing.set('');
  }

  public link(pubId: string, pl: Platform): SubmittedLink | undefined {
    return this.pubById()
      .get(pubId)
      ?.links.find((l) => l.platform === pl);
  }

  public readonly editing = signal('');

  public editUrl = '';

  public readonly busy = signal(false);

  public isEditing(pubId: string, pl: Platform): boolean {
    return this.editing() === `${pubId}|${pl}`;
  }

  public startEdit(pubId: string, pl: Platform): void {
    this.editUrl = this.link(pubId, pl)?.url ?? '';
    this.editing.set(`${pubId}|${pl}`);
  }

  public cancelEdit(): void {
    this.editing.set('');
  }

  /**
   * Заменить или добавить ссылку. Ручка одна: на сервере это вставка с
   * заменой по площадке, так что «добавить пропущенную» и «исправить
   * битую» — одно действие.
   */
  public save(pubId: string, pl: Platform): void {
    const url = this.editUrl.trim();
    if (!url || this.busy()) return;
    const had = !!this.link(pubId, pl);
    this.busy.set(true);
    this.api.managerEditLink(pubId, pl, url).subscribe({
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

  // ---- напомнить ----

  public readonly reminding = signal('');

  /**
   * Напомнить креатору о недостающих ссылках — тем же запросом, что в
   * плане. Уже напоминали сегодня — не отказ, а факт, и говорим это
   * спокойно, а не красной плашкой.
   */
  public remind(pubId: string, who?: string): void {
    if (this.reminding()) return;
    const name = who || 'креатору';
    this.reminding.set(pubId);
    this.api.managerRemind(pubId).subscribe({
      next: () => {
        this.reminding.set('');
        this.msg.success(`Напомнили: ${name}.`);
      },
      error: (e) => {
        this.reminding.set('');
        const err = parseApiError(e, 'Напоминание не ушло.');
        if (err.code === 'already_reminded') {
          this.msg.info(`Сегодня ${name} уже напоминали — следующее завтра.`);
          return;
        }
        this.msg.error(err.message);
      },
    });
  }

  public setMetric(m: MatrixMetric): void {
    this.metric.set(m);
  }

  public showMore(): void {
    this.phoneLimit.update((n) => n + 10);
  }

  public label(pl: Platform): string {
    return this.platformLabel[pl];
  }

  public bar(views: number | null, best: number): number {
    if (!views || !best) return 0;
    return Math.max(3, Math.round((views / best) * 100));
  }

  public views(c: MatrixCell): number | null {
    return cellValue(c, 'views');
  }

  public missingText(missing: Platform[]): string {
    return 'Нет ссылок: ' + missing.map((p) => this.platformLabel[p]).join(', ');
  }

  private show(pl: Platform, c: MatrixCell, metric: MatrixMetric, max: number): ShownCell {
    const base = {
      platform: pl,
      kind: c.kind,
      url: '',
      title: '',
      sub: '',
      heat: 0,
      erPct: null,
      erPartial: false,
    };
    switch (c.kind) {
      case 'none':
        return { ...base, text: 'нет ссылки' };
      case 'pending':
        return { ...base, url: c.url, text: 'собираем', sub: 'ссылка сдана' };
      case 'failed':
        // Подпись — для глаз, исходный ответ сборщика — в подсказке:
        // формулировка на той стороне меняется, а точный текст нужен,
        // чтобы понять, что именно ответили.
        return { ...base, url: c.url, text: collectErrorLabel(c.reason), title: c.reason };
      case 'ok': {
        const v = cellValue(c, metric);
        return {
          ...base,
          url: c.url,
          text: this.fmt(metric, v),
          sub:
            metric === 'views'
              ? c.growth === null
                ? 'первый замер'
                : signedDigits(c.growth)
              : groupDigits(c.views),
          heat: heat(v, max),
          erPct: c.er,
          erPartial: c.erPartial,
        };
      }
    }
  }

  private totalSub(
    metric: MatrixMetric,
    t: { views: number; growth: number | null; measured: number },
  ): string {
    // Ни одного снимка — и подписи нет. Иначе под прочерком стояло бы
    // «0», то есть ровно то число, которого мы в итоге не показываем.
    if (!t.measured) return 'снимков нет';
    if (metric !== 'views') return groupDigits(t.views);
    // Прирост суммы неизвестен, если хоть у одной площадки нет вчерашнего
    // снимка, — так и пишем, а не подставляем сумму известных.
    return t.growth === null ? 'есть первый замер' : signedDigits(t.growth);
  }

  public fmt(metric: MatrixMetric, v: number | null): string {
    if (v === null) return metric === 'growth' ? 'первый замер' : '—';
    if (metric === 'er') return v.toFixed(1).replace('.', ',') + '%';
    if (metric === 'growth') return signedDigits(v);
    return groupDigits(v);
  }
}
