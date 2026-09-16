import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { CommonModule } from '@angular/common';

import { NodataComponent } from '@shared/ui/nodata/nodata.component';
import { StepsComponent } from '@shared/ui/steps/steps.component';
import { plural } from '@shared/lib/format';
import { formatMoney } from '@entities/billing/lib/money';
import {
  LADDER_STEP,
  LadderVideo,
  TYPICAL_SOURCE_NOTE,
  ladderState,
  shortViews,
  stepMotivation,
} from '@entities/billing/lib/ladder';
import { videosInPeriod } from '@entities/billing/lib/creator-highlights';
import { isOpenPeriod, periodTitle, snapshotNote } from '@entities/billing/lib/period';
import type { CreatorEarnings } from '@entities/billing/model/billing.types';
import type { Publication } from '@entities/publication/model/publication.types';

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
  imports: [CommonModule, StepsComponent, NodataComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './creator-ladder.component.html',
  styleUrls: ['./creator-ladder.component.scss', './creator-ladder.component.touch.scss'],
})
export class CreatorLadderComponent {
  /** Заработок и периоды — одним ответом, страница его уже загрузила. */
  public readonly earnings = input<CreatorEarnings | null>(null);

  /** Свои выкладки. Чужих креатору не отдаёт и сам бэк. */
  public readonly publications = input<Publication[]>([]);

  /**
   * Креатор хочет добавить себе выкладку сверх плана.
   *
   * Окно открывает страница, а не шкала: у неё есть и чеклист проекта, и
   * список выкладок, и ручка. Шкала знает только момент, когда добрать
   * хочется, — про него и говорит.
   */
  public readonly addVideo = output<void>();

  public readonly step = LADDER_STEP;

  public readonly views = shortViews;

  public readonly money = formatMoney;

  // Нужен строке сумм под полосой: «осталось 100 тыс. просмотров».
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

  /**
   * Ролики этого периода: вышли между его границами, включительно.
   *
   * Отбор вынесен в lib и общий с блоком достижений: два экрана, которые
   * считают «ролики периода» каждый по-своему, рано или поздно назовут
   * разные ролики одного и того же периода.
   */
  public readonly periodVideos = computed<LadderVideo[]>(() =>
    videosInPeriod(this.allVideos(), this.period()),
  );

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

  // Доли пройденного ВНУТРИ ступени (progressPercent) здесь больше нет
  // вместе с полосой, которую она рисовала. Полоса мерила не то: на
  // сороковой ступени она показывала четыре пикселя заливки — «ты
  // ничего не заработал». Лесенка меряет пройденное целиком, и её
  // единственное число — ladder().passed.

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

  /**
   * Что осталось до ступени — одной строкой.
   *
   * Раньше здесь стояло три абзаца: чем закрыть ступень, сколько это
   * обычных роликов и что при выполненном плане остаток не сгорает.
   * Каждый по отдельности верен, а вместе они читались как объяснение,
   * почему у человека не вышло.
   *
   * Считается в роликах: ролики он снимает, просмотры с него не
   * спрашивают.
   */
  public readonly motivation = computed(() =>
    stepMotivation(this.toNext(), this.typical()?.typical_video_views ?? null),
  );

  // Список роликов периода, их вклад в ступень и обезличенное место по
  // медиане переехали в блок достижений (widgets/creator-highlights).
  // Здесь они спорили за внимание с главным числом экрана: человек
  // приходит на эту карточку с вопросом «сколько мне за это будет», и
  // ответ на него должен стоять один.
}
