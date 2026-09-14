import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { CommonModule } from '@angular/common';

import { formatMoney } from '@entities/billing/lib/money';
import {
  LADDER_STEP,
  LadderVideo,
  MATURE_DAYS,
  TYPICAL_SOURCE_NOTE,
  countLine,
  hitLine,
  hitVideo,
  isYoung,
  ladderState,
  shortViews,
  stepPlan,
  stepShare,
  stepShareText,
} from '@entities/billing/lib/ladder';
import { isOpenPeriod, periodTitle, snapshotNote } from '@entities/billing/lib/period';
import type { CreatorEarnings } from '@entities/billing/model/billing.types';
import type { Publication } from '@entities/publication/model/publication.types';
import { plural } from '@shared/lib/format';

/**
 * Что креатор зарабатывает в этом периоде и что добавит следующая
 * ступень.
 *
 * Главное здесь — ДЕНЬГИ. Раньше главным были просмотры, и экран говорил
 * «до следующей ступени 100 тыс. — это 34 обычных ролика». Число верное
 * и бесполезное сразу с двух сторон: тридцати четырёх дат в периоде не
 * бывает, то есть совету нельзя последовать, и он читается как «у тебя
 * нет шансов»; а главный вопрос — «сколько мне за это будет» — оставался
 * без ответа вовсе.
 *
 * Теперь полоса идёт от заработанного к тому, что будет на ступени, а
 * просмотры стоят строкой ниже пояснением. Подписи построены вокруг
 * хитов: по данным площадки ролик от пятнадцати тысяч — это каждый
 * десятый, от пятидесяти — каждый тридцатый, то есть ступень закрывается
 * одним сильным и двумя хорошими, а не тридцатью четырьмя средними.
 *
 * Денег здесь по-прежнему не считают. Заработанное приходит из
 * начисления, прогноз ступени — из next_step_forecast, и считает его тот
 * же код, что и настоящую выплату. Вторая копия расчёта в браузере
 * разошлась бы с серверной на первой же правке ставок — молча, и
 * заметили бы это в день выплаты.
 *
 * Чего креатору не показываем никогда: цен заказчика, маржи площадки,
 * чужих выплат и вообще чужих имён. Сравнение с проектом приходит с
 * сервера обезличенным числом и таким же остаётся на экране.
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

  public readonly shareText = stepShareText;

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
   * «Вышел» — published_at с сервера: самая ранняя известная дата среди
   * площадок. Ни дата сдачи ссылок, ни плановый срок сюда не годятся —
   * ссылки сдают и через неделю после выхода, а план это намерение.
   * Даты нет — ролик в расчёты не попадает: возраст у него неизвестен,
   * а на возрасте стоит и «зрелый», и «ещё растёт».
   */
  public readonly allVideos = computed<LadderVideo[]>(() =>
    this.publications()
      .filter((p) => p.status !== 'cancelled' && !!p.published_at)
      .map((p) => ({
        id: p.id,
        title: p.title,
        views: p.views,
        published_at: p.published_at,
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
   * что стоят на карточках роликов ниже, а не расчёт по тарифу.
   */
  public readonly viewsNow = computed(
    () => this.carryIn() + this.periodVideos().reduce((sum, v) => sum + v.views, 0),
  );

  public readonly ladder = computed(() => ladderState(this.viewsNow()));

  /**
   * Прогноз ступени с сервера. Может не прийти — у проекта нет периодов
   * или пустой тариф. Это штатное состояние, а не ошибка загрузки.
   */
  public readonly forecast = computed(() => this.earnings()?.next_step_forecast ?? null);

  /**
   * Сколько просмотров до ступени.
   *
   * Из прогноза, когда он есть: сервер считает остаток вместе с
   * перенесённым, а мы о размере переноса знаем только то, что он уже в
   * счёте. Без прогноза остаётся своя арифметика по тем же измеренным
   * просмотрам.
   */
  public readonly toNext = computed(() => this.forecast()?.views_to_go ?? this.ladder().toNext);

  /** Доля пройденного внутри ступени — ширина полосы. */
  public readonly progressPercent = computed(() => {
    const f = this.forecast();
    const share =
      f && f.step_views > 0 ? (f.step_views - f.views_to_go) / f.step_views : this.ladder().progress;
    return Math.round(Math.min(1, Math.max(0, share)) * 1000) / 10;
  });

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
    return rows.find((a) => a.period_start.slice(0, 10) === p.starts_on.slice(0, 10)) ?? null;
  });

  /**
   * Правый конец полосы: сколько будет на ступени.
   *
   * Заработанное плюс прогноз ступени. Оба числа посчитал сервер —
   * складываем, а не выводим: сложение двух готовых сумм не расчёт
   * тарифа, и разойтись здесь нечему.
   *
   * null, когда нет одного из двух: полоса тогда остаётся просмотровой,
   * а выдуманной суммы на ней не появляется.
   */
  public readonly atStep = computed(() => {
    const row = this.earned();
    const f = this.forecast();
    if (!row || !f) return null;
    return row.total + f.forecast_payout;
  });

  /**
   * Типичный ролик — готовым числом с сервера.
   *
   * Лесенку «своя история → медиана проекта → значение по умолчанию»
   * считает он. Своей копии этого правила здесь нет по той же причине,
   * по которой нет и границ периода: она разойдётся с сервером на первой
   * же правке, и связать одно с другим будет некому.
   */
  public readonly typical = computed(() => this.earnings()?.benchmark ?? null);

  /** «по твоим роликам» / «по роликам проекта» / «по площадке». */
  public readonly typicalNote = computed(() => {
    const b = this.typical();
    return b ? TYPICAL_SOURCE_NOTE[b.typical_video_source] : '';
  });

  /** Свой рекорд. Пусто, если он неотличим от обычного ролика. */
  public readonly hit = computed(() =>
    hitVideo(this.allVideos(), this.typical()?.typical_video_views ?? null),
  );

  /**
   * Сколько роликов периода ещё впереди: даты стоят, ссылок нет.
   *
   * Только внутри границ периода: выкладка, назначенная на следующий
   * период, в этот счёт не входит.
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

  /** Чем закрыть ступень: хитами первым, количеством вторым. */
  public readonly plan = computed(() =>
    stepPlan(this.toNext(), this.typical()?.typical_video_views ?? null, this.plannedLeft()),
  );

  /** «Один ролик на 100 тыс. закрывает ступень. Или два по 50 тыс.» */
  public readonly hitText = computed(() => {
    const p = this.plan();
    return p ? hitLine(p) : '';
  });

  /** «Обычными — это 34…». Пусто, когда количеством не выйти. */
  public readonly countText = computed(() => {
    const p = this.plan();
    return p ? countLine(p) : '';
  });

  /**
   * План периода выполнен: дат впереди не осталось.
   *
   * Отдельное состояние, а не «ноль роликов»: человеку нельзя советовать
   * снять ещё, когда снимать негде, — и нужно сказать, что недобранное
   * не сгорает.
   */
  public readonly planDone = computed(() => !!this.period() && this.plannedLeft() === 0);

  /**
   * Ролики периода со свежими сверху — у каждого виден его вклад.
   *
   * Вклад долей ступени и есть главное, чего экрану не хватало: «20 000»
   * само по себе не говорит, много это или мало, а «пятая часть ступени»
   * понятно сразу.
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
  public readonly inProgress = computed(() => this.periodVideos().filter((v) => isYoung(v)));

  /**
   * Его место по медиане ролика, обезличенно. Нет числа — нет и блока,
   * без объяснений и пустого места: сравнивать не с чем.
   *
   * Процентиль — доля роликов проекта НИЖЕ него, поэтому «в топ-N%» это
   * 100 − процентиль.
   */
  public readonly topPercent = computed(() => {
    const p = this.earnings()?.benchmark?.my_percentile;
    return p === undefined ? null : Math.max(1, 100 - p);
  });
}
