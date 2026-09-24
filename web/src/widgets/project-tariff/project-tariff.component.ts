import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { NzMessageService } from 'ng-zorro-antd/message';

import { BillingApi } from '@entities/billing/api/billing.api';
import { fromRubles, toRubles } from '@entities/billing/lib/money';
import type {
  BillingTerms,
  BillingTermsInput,
  TariffStep,
} from '@entities/billing/model/billing.types';
import { parseApiError } from '@shared/api/api-error';

/** Строка таблицы. Деньги здесь в РУБЛЯХ: в копейки переводим при отправке. */
interface Row {
  fromViews: number | null;
  clientFee: number | null;
  /** Пусто — «столько же, сколько платит заказчик». */
  creatorFee: number | null;
}

/**
 * Как считается всё, что сверх фикса.
 *
 * `steps` — крупными ступенями: набрали за период столько-то, период
 * стоит столько-то. Так звучит коммерческое предложение и так его
 * читает заказчик.
 *
 * `rate` — столько-то рублей за тысячу просмотров. Линейно, без порогов
 * объёма за период: понятнее на старте, когда объём ещё не известен и
 * обещать ступени рано.
 *
 * Это ДВА РАЗНЫХ ПРАВИЛА СЧЁТА, и смешивать их в одном периоде нельзя:
 * непустая лесенка на сервере отменяет ставку за тысячу, и «немножко
 * того, немножко этого» дало бы цену, которую не сойтись руками.
 */
type Mode = 'steps' | 'rate';

/**
 * Тариф ПРОЕКТА — таблица, а не копия общего прайса.
 *
 * Прайс площадки один на всех, и до сих пор это было единственным
 * способом назвать цену: чтобы поправить один проект, админ выпускал
 * новую версию прайса, а менеджер жал «Обновить из прайса» — и проект
 * молча переезжал на сегодняшние ставки. Договариваются же с каждым
 * заказчиком отдельно, и общий прайс здесь — шаблон, а не источник
 * правды.
 *
 * Строка — это ПОРОГ ОБЪЁМА и ЦЕНА ПЕРИОДА на нём, а не цена за каждые
 * сто тысяч просмотров: так звучит коммерческое предложение («набрали
 * 300 тысяч — период стоит 450») и так его читает заказчик.
 *
 * Правка действует с текущего периода. Подытоженный не трогается ни при
 * каких условиях: он заморожен вместе со срезом просмотров, и по нему
 * уже выставлен счёт — пересчитать его задним числом значило бы
 * поменять то, по чему рассчитались.
 */
@Component({
  selector: 'app-project-tariff',
  standalone: true,
  imports: [CommonModule, FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './project-tariff.component.html',
  styleUrl: './project-tariff.component.scss',
})
export class ProjectTariffComponent {
  private readonly api = inject(BillingApi);

  private readonly msg = inject(NzMessageService);

  public readonly projectId = input.required<string>();

  /** Тариф сохранён — экрану денег надо перечитать суммы. */
  public readonly saved = output<void>();

  public readonly loading = signal(true);

  public readonly busy = signal(false);

  public readonly rows = signal<Row[]>([]);

  /**
   * Фикс за период — отдельным полем, а не строкой таблицы.
   *
   * В лесенке он и есть ступень с порогом ноль, но читается это плохо:
   * «от 0 просмотров — 300 000 ₽» человек ищет глазами среди порогов,
   * тогда как фикс он знает до всякого KPI и вписывает первым. Наверх
   * его, а в таблице — только настоящие пороги.
   */
  public fixClient: number | null = null;

  public fixCreator: number | null = null;

  public readonly mode = signal<Mode>('steps');

  /** Ставка за тысячу просмотров — вторая модель. */
  public rateClient: number | null = null;

  public rateCreator: number | null = null;

  /** Прочие условия — в рублях и просмотрах, как их вводят. */
  public guaranteeViews: number | null = null;

  public tailRate: number | null = null;

  public tailThreshold: number | null = null;

  public subscriberRate: number | null = null;

  public creatorSubscriberRate: number | null = null;

  /** «Дополнительно» свёрнуто: девять из десяти правок — это таблица. */
  public readonly extraOpen = signal(false);

  private loadedFor = '';

  public constructor() {
    effect(() => {
      const id = this.projectId();
      if (!id || id === this.loadedFor) return;
      this.loadedFor = id;
      this.load(id);
    });
  }

  private load(projectId: string): void {
    this.loading.set(true);
    this.api.managerBilling(projectId).subscribe({
      next: (r) => {
        this.fill(r.terms ?? null);
        this.loading.set(false);
      },
      // 404 no_periods — у проекта ещё ничего не вышло. Это не сбой:
      // тариф как раз и задают до первого ролика.
      error: () => {
        this.fill(null);
        this.loading.set(false);
      },
    });
  }

  private fill(t: BillingTerms | null): void {
    // Нулевая ступень — фикс СТАРОЙ модели: у новых снимков её нет, у
    // старых она здесь и остаётся за бортом, потому что фикс приходит
    // своим полем. В таблице — только настоящие пороги.
    const rest = (t?.steps ?? []).filter((s) => s.from_views !== 0);
    const money = (v: number | null | undefined) =>
      v === null || v === undefined ? null : toRubles(v);

    // Фикс считается ЗА РОЛИК и живёт своей парой полей, одной на обе
    // модели. Раньше он прятался в нулевой ступени лесенки и в окладе
    // — одно и то же число в двух разных местах, и правка одного не
    // доезжала до другого.
    this.fixClient = money(t?.fee_per_video) ?? 0;
    this.fixCreator = money(t?.creator_fee_per_video);

    if (rest.length) {
      this.mode.set('steps');
      this.rateClient = null;
      this.rateCreator = null;
    } else {
      this.mode.set('rate');
      this.rateClient = t?.rate_per_1000_views ? toRubles(t.rate_per_1000_views) : null;
      this.rateCreator = money(t?.creator_rate_per_1000_views);
    }

    this.rows.set(
      rest.map((s) => ({
        fromViews: s.from_views,
        clientFee: toRubles(s.client_fee),
        creatorFee: money(s.creator_fee),
      })),
    );
    this.guaranteeViews = t?.guarantee_views ?? null;
    this.tailRate = t?.rate_per_1000_views_over ? toRubles(t.rate_per_1000_views_over) : null;
    this.tailThreshold = t?.bonus_views_threshold || null;
    this.subscriberRate = t?.subscriber_rate ? toRubles(t.subscriber_rate) : null;
    this.creatorSubscriberRate = t?.creator_subscriber_rate
      ? toRubles(t.creator_subscriber_rate)
      : null;
  }

  public addRow(): void {
    const last = this.rows()[this.rows().length - 1];
    // Новая ступень начинается выше предыдущей: порог, равный соседнему,
    // сервер отклонит, а нулевой в таблице означал бы второй фикс.
    const from = last?.fromViews ? last.fromViews * 2 : 300_000;
    this.rows.set([...this.rows(), { fromViews: from, clientFee: null, creatorFee: null }]);
  }

  public setMode(m: Mode): void {
    this.mode.set(m);
  }

  public removeRow(i: number): void {
    this.rows.set(this.rows().filter((_, idx) => idx !== i));
  }

  public setCell(i: number, field: keyof Row, value: number | null): void {
    this.rows.set(this.rows().map((r, idx) => (idx === i ? { ...r, [field]: value } : r)));
  }

  /**
   * Ступени по возрастанию порога — как их читает счёт.
   *
   * Сортируем ПОКАЗ, а не саму таблицу: строку добавляют в конец, и
   * перестроение списка под курсором увело бы поле ввода из-под рук.
   */
  public readonly sorted = computed(() =>
    this.rows()
      .map((r, i) => ({ r, i }))
      .sort((a, b) => (a.r.fromViews ?? 0) - (b.r.fromViews ?? 0)),
  );

  /**
   * Что не так с тарифом. Пусто — можно сохранять.
   *
   * Обычный метод, а не computed: половина формы — простые поля с
   * ngModel, а не сигналы, и кэширующийся computed показывал бы
   * позавчерашнюю ошибку. Строк здесь единицы, считать каждый цикл
   * дешевле, чем разводить сигналы ради кэша.
   */
  public problem(): string {
    const fix = this.fixState();
    if (fix) return fix;
    if (this.mode() === 'rate') {
      if (
        this.rateCreator !== null &&
        this.rateClient !== null &&
        this.rateCreator > this.rateClient
      ) {
        return 'За тысячу креатору обещано больше, чем платит заказчик.';
      }
      return '';
    }
    const seen = new Set<number>();
    for (const r of this.rows()) {
      if (r.fromViews === null || r.fromViews <= 0) {
        return 'Порог ступени — число просмотров больше нуля. Нулевой порог — это фикс, он выше.';
      }
      if (r.clientFee === null || r.clientFee < 0)
        return 'У каждой ступени должна быть цена периода.';
      if (seen.has(r.fromViews)) {
        return 'Две ступени с одним порогом — непонятно, по какой считать.';
      }
      seen.add(r.fromViews);
      if (r.creatorFee !== null && r.creatorFee > r.clientFee) {
        return 'Креатору обещано больше, чем платит заказчик, — проверьте ступень.';
      }
    }
    return '';
  }

  /** Проверка фикса вынесена: она одна на обе модели. */
  private fixState(): string {
    if (this.fixClient !== null && this.fixClient < 0) return 'Фикс не бывает отрицательным.';
    if (this.fixCreator !== null && this.fixClient !== null && this.fixCreator > this.fixClient) {
      return 'Фикс креатору больше, чем платит заказчик, — почти всегда это описка.';
    }
    return '';
  }

  public save(): void {
    if (this.busy() || this.problem()) return;
    const ladder = this.mode() === 'steps';
    // Нулевой ступени больше нет: её место занял фикс за ролик, и
    // отправлять её вместе с ним значило бы взять цену дважды.
    const steps: TariffStep[] = ladder
      ? this.rows().map((r) => ({
          from_views: r.fromViews ?? 0,
          client_fee: fromRubles(r.clientFee ?? 0),
          creator_fee: r.creatorFee === null ? null : fromRubles(r.creatorFee),
        }))
      : [];
    // Две модели не смешиваются: непустая лесенка отменяет ставку за
    // тысячу, и оставить в снимке числа от другого правила счёта значит
    // однажды посчитать проект дважды разными способами.
    const input: BillingTermsInput = {
      // Фикс — за ролик, своей парой полей и одинаково в обеих моделях.
      fee_per_video: fromRubles(this.fixClient ?? 0),
      creator_fee_per_video: this.fixCreator === null ? null : fromRubles(this.fixCreator),
      // Оклад за период остаётся в снимке нулём: механика выключена, но
      // поле в тарифе есть, и оставить в нём прежнее число значило бы
      // посчитать фикс дважды.
      salary_per_month: 0,
      rate_per_1000_views: ladder ? 0 : fromRubles(this.rateClient ?? 0),
      creator_salary_per_month: null,
      creator_rate_per_1000_views:
        ladder || this.rateCreator === null ? null : fromRubles(this.rateCreator),
      rate_per_1000_views_over: this.tailRate ? fromRubles(this.tailRate) : 0,
      bonus_views_threshold: this.tailThreshold ?? 0,
      steps,
      guarantee_views: this.guaranteeViews ?? null,
      subscriber_rate: this.subscriberRate === null ? null : fromRubles(this.subscriberRate),
      creator_subscriber_rate:
        this.creatorSubscriberRate === null ? null : fromRubles(this.creatorSubscriberRate),
    };
    this.busy.set(true);
    this.api.managerSaveTerms(this.projectId(), input).subscribe({
      next: (t) => {
        this.busy.set(false);
        this.fill(t);
        this.msg.success('Тариф сохранён. Текущий период пересчитан, подытоженные не тронуты.');
        this.saved.emit();
      },
      error: (e) => {
        this.busy.set(false);
        this.msg.error(parseApiError(e, 'Не удалось сохранить тариф.').message);
      },
    });
  }

  /**
   * Заполнить таблицу из общего прайса — как ШАБЛОН.
   *
   * Дальше числа живут своей жизнью: правка прайса этот проект уже не
   * трогает. Поэтому кнопка и называется «заполнить», а не «привязать».
   */
  public fromPrice(): void {
    if (this.busy()) return;
    this.busy.set(true);
    this.api.managerAdoptTerms(this.projectId()).subscribe({
      next: (t) => {
        this.busy.set(false);
        this.fill(t);
        // Прайс площадки может быть на старой модели — оклад плюс ставка
        // за тысячу, без ступеней. Сказать «заполнили» и оставить пустую
        // таблицу значило бы соврать: человек решит, что кнопка не
        // сработала, и нажмёт ещё раз.
        this.msg.success(
          this.rows().length
            ? 'Заполнили из прайса. Поправьте под проект и сохраните.'
            : 'В прайсе площадки ступеней нет — соберите таблицу сами.',
        );
      },
      error: (e) => {
        this.busy.set(false);
        this.msg.error(parseApiError(e, 'Не удалось взять числа из прайса.').message);
      },
    });
  }
}
