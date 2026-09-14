import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { CommonModule } from '@angular/common';

import { formatMoney } from '@entities/billing/lib/money';
import {
  LADDER_STEP,
  LadderVideo,
  MATURE_DAYS,
  bestVideos,
  forecastViews,
  hitVideo,
  isYoung,
  ladderMarks,
  ladderState,
  shortViews,
  typicalVideo,
  videoTarget,
  videosToStep,
} from '@entities/billing/lib/ladder';
import { isOpenPeriod, periodTitle, snapshotNote } from '@entities/billing/lib/period';
import type { CreatorEarnings } from '@entities/billing/model/billing.types';
import type { Publication } from '@entities/publication/model/publication.types';
import { plural } from '@shared/lib/format';

/**
 * Шкала прогресса креатора: ступени по просмотрам, ступень — 100 000.
 *
 * Отвечает на один вопрос — «что мне сделать прямо сейчас». Поэтому всё
 * здесь сведено к одному действию: сколько просмотров до следующей
 * ступени и сколько это роликов. Упрёков нет ни в одном состоянии: не
 * успеваешь — это про то, сколько осталось, а не про то, кто виноват.
 *
 * Чего креатору не показываем никогда: цен заказчика, маржи площадки,
 * чужих выплат и вообще чужих имён. Сравнение с проектом приходит с
 * сервера обезличенным числом и таким же остаётся на экране.
 *
 * Денег за ступень тут нет намеренно. Ступенчатый тариф ещё не выпущен —
 * в действующем ступени нет вовсе, и «+X ₽ за ступень» было бы
 * придуманным числом. Место под сумму в вёрстке оставлено (.reward), но
 * текстом не заполняется: пустая строка честнее выдуманной.
 */
@Component({
  selector: 'app-creator-ladder',
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './creator-ladder.component.html',
  styleUrl: './creator-ladder.component.scss',
})
export class CreatorLadderComponent {
  /** Заработок и периоды — одним ответом, страница его уже загрузила. */
  public readonly earnings = input<CreatorEarnings | null>(null);

  /** Свои выкладки. Чужих креатору не отдаёт и сам бэк. */
  public readonly publications = input<Publication[]>([]);

  public readonly step = LADDER_STEP;

  public readonly matureDays = MATURE_DAYS;

  public readonly views = shortViews;

  public readonly money = formatMoney;

  public plural(n: number, one: string, few: string, many: string): string {
    return plural(n, one, few, many);
  }

  /**
   * Текущий период. Границы приходят с сервера — выводить их из даты
   * начала прибавлением месяца нельзя: правило периода живёт на сервере,
   * и вторая его копия в браузере разъедется молча.
   */
  public readonly period = computed(() => this.earnings()?.period ?? null);

  public readonly periodTitle = computed(() => periodTitle(this.period()));

  /** Период идёт — числа ещё изменятся. */
  public readonly preliminary = computed(() => isOpenPeriod(this.period()));

  /** Числа подтянуты, а не измерены. Отдельная пометка, другим тоном. */
  public readonly approximate = computed(() => !!this.period()?.snapshot_approx);

  public readonly snapshotNote = computed(() => snapshotNote(this.period()));

  /**
   * Свои ролики как их видит расчёт.
   *
   * «Вышел» — момент, когда сдана первая ссылка: настоящей даты
   * публикации у выкладки в API нет, а плановый срок это план, а не
   * факт. Ролик без ссылок не вышел вовсе и в расчёты не попадает.
   */
  public readonly allVideos = computed<LadderVideo[]>(() =>
    this.publications()
      .filter((p) => p.status !== 'cancelled' && p.links.length > 0)
      .map((p) => ({
        id: p.id,
        title: p.title,
        views: p.views,
        published_at: publishedAt(p),
      })),
  );

  /** Ролики этого периода: вышли между его границами, включительно. */
  public readonly periodVideos = computed<LadderVideo[]>(() => {
    const p = this.period();
    if (!p) return [];
    const from = p.starts_on.slice(0, 10);
    const to = p.ends_on.slice(0, 10);
    return this.allVideos().filter((v) => {
      const day = (v.published_at ?? '').slice(0, 10);
      return !!day && day >= from && day <= to;
    });
  });

  /** Перенос с прошлого периода: он уже в счёте ступеней. */
  public readonly carryIn = computed(() => this.period()?.carry_in_creator ?? 0);

  /**
   * Просмотры в счёте ступеней: перенос плюс ролики периода.
   *
   * Складываем сами — и только просмотры. Это измеренные числа, те же,
   * что стоят на карточках роликов ниже, а не расчёт по тарифу. Деньги
   * наоборот берутся у сервера как есть: второй расчёт денег в браузере
   * разойдётся с серверным на первой же правке ставок.
   */
  public readonly viewsNow = computed(
    () => this.carryIn() + this.periodVideos().reduce((sum, v) => sum + v.views, 0),
  );

  public readonly ladder = computed(() => ladderState(this.viewsNow()));

  public readonly marks = computed(() => ladderMarks(this.ladder()));

  /** Доля пройденного внутри текущей ступени — ширина полосы. */
  public readonly progressPercent = computed(() => Math.round(this.ladder().progress * 1000) / 10);

  /**
   * Типичный ролик. Своих зрелых меньше десяти — берём обезличенную
   * медиану проекта, её может не быть вовсе: в маленьком проекте медиана
   * перестаёт быть агрегатом и превращается в результат соседа.
   */
  public readonly typical = computed(() =>
    typicalVideo(this.allVideos(), this.earnings()?.project_median_views ?? null),
  );

  /** Свой рекорд. Пусто, если он неотличим от обычного ролика. */
  public readonly hit = computed(() => hitVideo(this.allVideos(), this.typical()));

  /** Сколько роликов до ступени: обычными и «один хит плюс N обычных». */
  public readonly plan = computed(() => {
    const t = this.typical();
    if (!t) return null;
    return videosToStep(this.ladder().toNext, t.views, this.hit());
  });

  /**
   * «это 20 обычных роликов, или 1 хит и 8 обычных» — фразой целиком.
   *
   * Собираем в компоненте, а не в шаблоне: управляющий блок посреди
   * предложения выносит запятую и точку на свою строку, и после
   * схлопывания пробелов получается «роликов , или … обычных .».
   */
  public readonly planText = computed(() => {
    const p = this.plan();
    if (!p) return '';
    const normal = `${p.normal} ${plural(p.normal, 'обычный ролик', 'обычных ролика', 'обычных роликов')}`;
    if (p.withHit === null) return `это ${normal}`;
    if (p.withHit === 0) return `это ${normal} или один хит`;
    const rest = plural(p.withHit, 'обычный', 'обычных', 'обычных');
    return `это ${normal} или 1 хит и ${p.withHit} ${rest}`;
  });

  /** Вышли, но ещё растут: младше двух недель. */
  public readonly inProgress = computed(() => this.periodVideos().filter((v) => isYoung(v)));

  /**
   * Сколько роликов периода ещё впереди: даты стоят, ссылок нет.
   *
   * Только внутри границ периода: выкладка, назначенная на следующий
   * период, в этот прогноз не входит.
   */
  public readonly plannedLeft = computed(() => {
    const p = this.period();
    if (!p) return 0;
    const from = p.starts_on.slice(0, 10);
    const to = p.ends_on.slice(0, 10);
    return this.publications().filter(
      (x) =>
        x.status !== 'cancelled' &&
        x.links.length === 0 &&
        x.due_date.slice(0, 10) >= from &&
        x.due_date.slice(0, 10) <= to,
    ).length;
  });

  /** Прогноз на конец периода. Пусто, пока не на чем считать. */
  public readonly forecast = computed(() => {
    const t = this.typical();
    if (!t) return null;
    return forecastViews({
      current: this.viewsNow(),
      young: this.inProgress().map((v) => v.views),
      typical: t.views,
      plannedLeft: this.plannedLeft(),
    });
  });

  /** Успевает ли до следующей ступени к концу периода. */
  public readonly reachesNext = computed(() => {
    const f = this.forecast();
    return f !== null && f >= this.ladder().nextAt;
  });

  /** Три лучших ролика периода — чтобы было видно, что повторять. */
  public readonly best = computed(() => bestVideos(this.periodVideos()));

  /**
   * Заработок за период — из его же начисления, как посчитал сервер.
   *
   * Строка знает только дату начала своего периода, поэтому ищем по ней.
   * Начисления может не быть вовсе: пока период не пересчитывали, строки
   * в базе нет. Это не ноль — это «ещё не посчитано», и показывать здесь
   * ноль значило бы сказать «ты ничего не заработал».
   */
  public readonly earned = computed(() => {
    const p = this.period();
    const rows = this.earnings()?.accruals ?? [];
    if (!p) return null;
    const row = rows.find((a) => a.period_start.slice(0, 10) === p.starts_on.slice(0, 10));
    return row ?? null;
  });

  /** Его место по медиане ролика, обезличенно. Нет числа — нет и блока. */
  public readonly percentile = computed(() => this.earnings()?.project_percentile ?? null);

  /** До чего тянуть конкретный ролик: до типичного, потом до рекорда. */
  public target(v: LadderVideo) {
    const t = this.typical();
    return t ? videoTarget(v.views, t.views, this.hit()) : null;
  }
}

/**
 * Когда ролик вышел: первая сданная ссылка.
 *
 * Момент сдачи ссылки, а не плановый срок: план это намерение, и считать
 * по нему значит начать отсчёт от ролика, который мог не выйти. Точной
 * даты публикации в выкладке нет — сервер её и не хранит.
 */
function publishedAt(p: Publication): string | undefined {
  const dates = p.links.map((l) => l.submitted_at).filter(Boolean);
  return dates.length ? dates.reduce((a, b) => (a < b ? a : b)) : undefined;
}
