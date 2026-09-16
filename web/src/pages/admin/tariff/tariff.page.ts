import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzMessageService } from 'ng-zorro-antd/message';

import { BillingApi } from '@entities/billing/api/billing.api';
import { TariffStep, TermsVersion } from '@entities/billing/model/billing.types';
import { formatMoney, fromRubles, toRubles } from '@entities/billing/lib/money';
import { parseApiError } from '@shared/api/api-error';
import { PageHeadComponent } from '@shared/ui/page-head/page-head.component';

/**
 * Прайс площадки: сколько платит заказчик за креатора и сколько из этого
 * получает сам креатор.
 *
 * Здесь нет «сохранить». Версия прайса не правится, а выпускается заново:
 * под действующей стоит согласие клиентов, а проекты сняли с неё числа
 * снимком. Переписать её задним числом значило бы поменять то, под чем
 * уже стоит подпись.
 *
 * Форма всегда открывается копией действующей версии — прайс меняют
 * правкой одной ставки, а не набором тринадцати полей с нуля.
 */
interface Draft {
  // Клиентская сторона — что платит заказчик. Рубли, не копейки: в поле
  // ввода человек пишет рубли, в копейки переводим на отправке.
  salary: number;
  videosFirst: number;
  videosNext: number;
  rate: number;
  threshold: number;
  rateOver: number;
  // Креаторская сторона — что из этого получает исполнитель. Пусто
  // значит «столько же, сколько платит клиент»: платформа ничего не
  // удерживает. Это не то же самое, что ноль.
  creatorSalary: number | null;
  creatorRate: number | null;
  creatorRateOver: number | null;
  // Переходы по UTM. Счётчика кликов у нас нет — цифры менеджер сводит
  // руками из аналитики заказчика, — но ставка должна быть объявлена:
  // и клиент, и менеджер считают по ней, а не по памяти.
  countClicks: boolean;
  clickRate: number | null;
  clickThreshold: number | null;
  clickRateOver: number | null;
  // Ступени: произвольное число порогов объёма и цена периода на каждом.
  // Список, а не набор полей, ровно потому, что число ступеней заранее
  // неизвестно — живой клиент просит «оклад плюс KPI на 300 000», и
  // следом появляются четвёртая и пятая точка.
  steps: DraftStep[];
  // KPI по подписчикам. Сборщика подписчиков нет — объявляем только
  // ставку, число потом вписывает менеджер руками.
  countSubs: boolean;
  subRate: number | null;
  creatorSubRate: number | null;
  body: string;
}

/** Ступень в форме: рубли и просмотры, как их вводит человек. */
interface DraftStep {
  fromViews: number;
  clientFee: number;
  // Пусто — «как у заказчика»: то же правило, что у остальных
  // креаторских полей.
  creatorFee: number | null;
}

@Component({
  selector: 'app-admin-tariff',
  standalone: true,
  imports: [CommonModule, FormsModule, NzButtonModule, PageHeadComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './tariff.page.html',
  styleUrl: './tariff.page.scss',
})
export class AdminTariffPage implements OnInit {
  private readonly api = inject(BillingApi);

  private readonly msg = inject(NzMessageService);

  public readonly versions = signal<TermsVersion[]>([]);

  public readonly loading = signal(true);

  public readonly saving = signal(false);

  public readonly formOpen = signal(false);

  public readonly current = computed(() => this.versions().find((v) => v.is_current) ?? null);

  public draft: Draft = emptyDraft();

  public ngOnInit(): void {
    this.load();
  }

  private load(): void {
    this.loading.set(true);
    this.api.adminListTerms().subscribe({
      next: (r) => {
        this.versions.set(r.items);
        this.loading.set(false);
      },
      error: (e) => {
        this.loading.set(false);
        this.msg.error(parseApiError(e, 'Не удалось загрузить прайс.').message);
      },
    });
  }

  /** Версия пишется одинаково во всей CRM: `v1 · действует`. */
  public versionLabel(v: TermsVersion): string {
    return v.is_current ? `v${v.version} · действует` : `v${v.version}`;
  }

  public money(kopecks: number | null | undefined): string {
    return formatMoney(kopecks);
  }

  /** Ставка креатора не задана — значит она равна клиентской. */
  public creatorShare(v: TermsVersion, field: 'salary' | 'rate' | 'rateOver'): number {
    if (field === 'salary') return v.creator_salary_per_month ?? v.salary_per_month;
    if (field === 'rate') return v.creator_rate_per_1000_views ?? v.rate_per_1000_views;
    return v.creator_rate_per_1000_views_over ?? v.rate_per_1000_views_over;
  }

  /** Считаем ли переходы вообще: пустая ставка — «не считаем». */
  public clicksOn(v: TermsVersion): boolean {
    return v.click_bonus_rate != null;
  }

  /** Что остаётся площадке с одного оклада — то, ради чего две стороны. */
  public marginSalary(v: TermsVersion): number {
    return v.salary_per_month - this.creatorShare(v, 'salary');
  }

  /**
   * Ступени действующей версии — для карточки прайса.
   *
   * Уже отсортированы сервером по порогу, и пересортировывать их здесь
   * незачем: порядок — часть смысла лесенки, и второе его место
   * разъехалось бы с первым.
   */
  public steps(v: TermsVersion): TariffStep[] {
    return v.steps ?? [];
  }

  /** Цена ступени креатору: пусто в тарифе значит «как у заказчика». */
  public stepCreatorFee(s: TariffStep): number {
    return s.creator_fee ?? s.client_fee;
  }

  public subsOn(v: TermsVersion): boolean {
    return v.subscriber_rate != null;
  }

  /**
   * Добавить ступень.
   *
   * Новая встаёт в конец с пустыми числами: подставлять «удобные»
   * значения нельзя — выпущенная версия прайса необратима, и число,
   * которого админ не вводил, окажется в счёте заказчика.
   */
  public addStep(): void {
    this.draft.steps = [...this.draft.steps, { fromViews: 0, clientFee: 0, creatorFee: null }];
  }

  public removeStep(i: number): void {
    this.draft.steps = this.draft.steps.filter((_, idx) => idx !== i);
  }

  public openForm(): void {
    const v = this.current();
    this.draft = v ? draftFrom(v) : emptyDraft();
    this.formOpen.set(true);
  }

  public closeForm(): void {
    this.formOpen.set(false);
  }

  public publish(): void {
    const d = this.draft;
    if (!d.body.trim()) {
      this.msg.error('Текст условий обязателен — с ним соглашается заказчик.');
      return;
    }
    this.saving.set(true);
    this.api
      .adminPublishTerms({
        salary_per_month: fromRubles(d.salary),
        videos_first_month: d.videosFirst,
        videos_next_months: d.videosNext,
        rate_per_1000_views: fromRubles(d.rate),
        bonus_views_threshold: d.threshold,
        rate_per_1000_views_over: fromRubles(d.rateOver),
        creator_salary_per_month: d.creatorSalary === null ? null : fromRubles(d.creatorSalary),
        creator_rate_per_1000_views: d.creatorRate === null ? null : fromRubles(d.creatorRate),
        creator_rate_per_1000_views_over:
          d.creatorRateOver === null ? null : fromRubles(d.creatorRateOver),
        click_bonus_rate: d.countClicks && d.clickRate !== null ? fromRubles(d.clickRate) : null,
        click_bonus_threshold: d.countClicks ? (d.clickThreshold ?? 0) : 0,
        click_bonus_rate_over:
          d.countClicks && d.clickRateOver !== null ? fromRubles(d.clickRateOver) : null,
        // Лесенка уезжает целиком и уже отсортированной: порядок — часть
        // правила «берём последнюю взятую ступень», и отдавать его на
        // усмотрение порядка строк в форме нельзя.
        steps: [...d.steps]
          .sort((a, b) => a.fromViews - b.fromViews)
          .map((st) => ({
            from_views: Math.max(0, Math.round(st.fromViews)),
            client_fee: fromRubles(st.clientFee),
            creator_fee: st.creatorFee === null ? null : fromRubles(st.creatorFee),
          })),
        subscriber_rate: d.countSubs && d.subRate !== null ? fromRubles(d.subRate) : null,
        creator_subscriber_rate:
          d.countSubs && d.creatorSubRate !== null ? fromRubles(d.creatorSubRate) : null,
        body: d.body.trim(),
      })
      .subscribe({
        next: () => {
          this.saving.set(false);
          this.formOpen.set(false);
          this.msg.success('Новая версия прайса выпущена');
          this.load();
        },
        error: (e) => {
          this.saving.set(false);
          this.msg.error(parseApiError(e, 'Не удалось выпустить версию.').message);
        },
      });
  }
}

function emptyDraft(): Draft {
  return {
    salary: 0,
    videosFirst: 0,
    videosNext: 0,
    rate: 0,
    threshold: 0,
    rateOver: 0,
    creatorSalary: null,
    creatorRate: null,
    creatorRateOver: null,
    countClicks: false,
    clickRate: null,
    clickThreshold: null,
    clickRateOver: null,
    steps: [],
    countSubs: false,
    subRate: null,
    creatorSubRate: null,
    body: '',
  };
}

function draftFrom(v: TermsVersion): Draft {
  const opt = (k?: number) => (k === undefined || k === null ? null : toRubles(k));
  return {
    salary: toRubles(v.salary_per_month),
    videosFirst: v.videos_first_month ?? 0,
    videosNext: v.videos_next_months ?? 0,
    rate: toRubles(v.rate_per_1000_views),
    threshold: v.bonus_views_threshold,
    rateOver: toRubles(v.rate_per_1000_views_over),
    creatorSalary: opt(v.creator_salary_per_month),
    creatorRate: opt(v.creator_rate_per_1000_views),
    creatorRateOver: opt(v.creator_rate_per_1000_views_over),
    // Пустая ставка перехода — это «переходы не считаем» целиком, а не
    // нулевая ставка: галочка и есть это различие.
    countClicks: v.click_bonus_rate != null,
    clickRate: opt(v.click_bonus_rate),
    clickThreshold: v.click_bonus_threshold ?? null,
    clickRateOver: opt(v.click_bonus_rate_over),
    steps: (v.steps ?? []).map((st) => ({
      fromViews: st.from_views,
      clientFee: toRubles(st.client_fee),
      creatorFee: opt(st.creator_fee ?? undefined),
    })),
    // Пустая ставка за подписчика — это «KPI не считаем» целиком, а не
    // нулевая ставка: галочка и есть это различие.
    countSubs: v.subscriber_rate != null,
    subRate: opt(v.subscriber_rate),
    creatorSubRate: opt(v.creator_subscriber_rate),
    body: v.body,
  };
}
