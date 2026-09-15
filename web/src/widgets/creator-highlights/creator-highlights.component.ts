import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { CommonModule } from '@angular/common';

import {
  MATURE_DAYS,
  type LadderVideo,
  isYoung,
  shortViews,
  stepShare,
  stepShareText,
} from '@entities/billing/lib/ladder';
import {
  bestVideo,
  periodHistory,
  platformLead,
  platformStats,
  videosInPeriod,
  viewsTrend,
} from '@entities/billing/lib/creator-highlights';
import { periodDay } from '@entities/billing/lib/period';
import type { CreatorEarnings } from '@entities/billing/model/billing.types';
import { PLATFORM_LABEL } from '@entities/publication/lib/publication-status';
import type { Publication, PublicationReport } from '@entities/publication/model/publication.types';
import { plural } from '@shared/lib/format';

/**
 * Что у креатора получается лучше всего.
 *
 * Второй вопрос кабинета после денег и единственный, ради которого сюда
 * заходят не по делу: «сколько я заработал» смотрят перед выплатой,
 * а «какой у меня лучший ролик» — просто так. До этого блока кабинет
 * отвечал только на вопросы, которые задаёт работа, и открывали его
 * ровно в дни сдачи ссылок.
 *
 * Все числа здесь — его собственные и измеренные: просмотры роликов,
 * разрез по площадкам из его же отчёта, просмотры периодов из
 * начислений. Ничего не придумано и не усреднено по площадке.
 *
 * Чего здесь нет и не будет: чужих результатов, имён и любых сравнений,
 * кроме того обезличенного процентиля, который присылает сервер, — и
 * того только когда присылает. У него свой порог обезличивания; не
 * прислал — блока нет вовсе, без объяснений и пустого места.
 *
 * И падение здесь называется падением. Половина ценности блока — в том,
 * что ему можно верить в плохой месяц.
 */
@Component({
  selector: 'app-creator-highlights',
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './creator-highlights.component.html',
  styleUrl: './creator-highlights.component.scss',
})
export class CreatorHighlightsComponent {
  /** Заработок, периоды и обезличенный ориентир — одним ответом. */
  public readonly earnings = input<CreatorEarnings | null>(null);

  /** Свои выкладки. Чужих креатору не отдаёт и сам бэк. */
  public readonly publications = input<Publication[]>([]);

  /**
   * Отчёт по СВОИМ роликам: бэк фильтрует его по текущему пользователю.
   * Отсюда разрез по площадкам — чужих строк в нём нет.
   */
  public readonly report = input<PublicationReport | null>(null);

  public readonly views = shortViews;

  public readonly shareText = stepShareText;

  public readonly platformLabel = PLATFORM_LABEL;

  public readonly matureDays = MATURE_DAYS;

  public plural(n: number, one: string, few: string, many: string): string {
    return plural(n, one, few, many);
  }

  /** «12 сентября» — дата выхода ролика в родительном падеже. */
  public day(iso: string | undefined): string {
    return iso ? periodDay(iso, true) : '';
  }

  public readonly period = computed(() => this.earnings()?.period ?? null);

  /**
   * Свои вышедшие ролики. Без published_at ролик в расчёты не попадает:
   * неизвестен возраст, а на нём стоит и «зрелый», и «ещё растёт».
   */
  public readonly allVideos = computed<LadderVideo[]>(() =>
    this.publications()
      .filter((p) => p.status !== 'cancelled' && !!p.published_at)
      .map((p) => ({ id: p.id, title: p.title, views: p.views, published_at: p.published_at })),
  );

  public readonly periodVideos = computed(() => videosInPeriod(this.allVideos(), this.period()));

  /** Лучший ролик периода. Пусто — в периоде ещё ничего не вышло. */
  public readonly bestOfPeriod = computed(() => bestVideo(this.periodVideos()));

  /** Лучший за всё время проекта. */
  public readonly bestEver = computed(() => bestVideo(this.allVideos()));

  /**
   * Рекорд периода и рекорд проекта — один и тот же ролик.
   *
   * Тогда о нём говорим один раз и добавляем, что он же лучший за всё
   * время. Две карточки с одинаковым числом читаются как ошибка, а не
   * как два достижения.
   */
  public readonly bestIsRecord = computed(() => {
    const a = this.bestOfPeriod();
    const b = this.bestEver();
    return !!a && !!b && a.id === b.id;
  });

  public readonly isYoung = isYoung;

  /** Площадки его роликов, сильные первыми. */
  public readonly platforms = computed(() => platformStats(this.report()?.by_platform));

  /**
   * Площадка, где он впереди остальных. Пусто — лидера нет, и тогда
   * список площадок показывается без заголовка «сильнее всего»: разрез
   * сам по себе полезен, а выдуманного лидера в нём быть не должно.
   */
  public readonly lead = computed(() => platformLead(this.platforms()));

  /** История периодов — нужна здесь только ради тренда просмотров. */
  private readonly history = computed(() =>
    periodHistory(this.earnings()?.accruals, this.earnings()?.periods),
  );

  /**
   * Растут ли просмотры от периода к периоду. Пусто, когда законченный
   * период всего один: тренда из одной точки не бывает.
   */
  public readonly trend = computed(() => viewsTrend(this.history()));

  /**
   * «+80 тыс.» / «−40 тыс.» / «без изменений».
   *
   * Собрано здесь, а не в шаблоне: знак и запятая, разложенные по
   * @if-веткам, разъезжаются пробелами — Angular склеивает текстовые
   * узлы через пробел, и получается «периоде , это +50 % .».
   */
  public readonly trendDeltaText = computed(() => {
    const t = this.trend();
    if (!t) return '';
    if (t.direction === 'up') return `+${shortViews(t.delta)}`;
    if (t.direction === 'down') return `−${shortViews(-t.delta)}`;
    return 'без изменений';
  });

  /** «+50%» / «−33%». Пусто, когда в прошлом периоде был ноль. */
  public readonly trendPercentText = computed(() => {
    const t = this.trend();
    if (!t || t.percent === null || t.delta === 0) return '';
    return t.percent > 0 ? `+${t.percent}%` : `−${Math.abs(t.percent)}%`;
  });

  /**
   * Ролики периода со вкладом в ступень, сильные первыми.
   *
   * Переехали сюда из денежной шкалы: там они спорили за внимание с
   * главным числом экрана, а здесь они и есть ответ на вопрос «что у
   * меня получается» — список собственных результатов по убыванию.
   */
  public readonly contributions = computed(() =>
    [...this.periodVideos()]
      .sort((a, b) => b.views - a.views)
      .map((v) => ({
        id: v.id,
        title: v.title,
        views: v.views,
        share: stepShareText(v.views),
        percent: Math.min(100, Math.round(stepShare(v.views) * 100)),
        young: isYoung(v),
      })),
  );

  /** Вышли, но ещё растут: младше двух недель. */
  public readonly growing = computed(() => this.periodVideos().filter((v) => isYoung(v)));

  /**
   * Его место по медиане ролика, обезличенно. Нет числа — нет и блока:
   * у сравнения свой порог обезличивания, и ниже него «медиана проекта»
   * это результат соседа, а не агрегат.
   *
   * Процентиль — доля роликов проекта НИЖЕ него, поэтому «в топ-N%» это
   * 100 − процентиль.
   */
  public readonly topPercent = computed(() => {
    const p = this.earnings()?.benchmark?.my_percentile;
    return p === undefined ? null : Math.max(1, 100 - p);
  });

  /**
   * Показывать ли блок вообще.
   *
   * Ни одного вышедшего ролика — говорить не о чем, и пустая карточка
   * «достижений» на пустом проекте поздравляла бы с ничем. Ровно эту
   * ошибку мы уже чинили в зелёном значке «всё сдано».
   */
  public readonly hasAnything = computed(() => this.allVideos().some((v) => v.views > 0));
}
