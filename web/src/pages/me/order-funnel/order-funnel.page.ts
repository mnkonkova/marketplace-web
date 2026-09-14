import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  OnInit,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { NzMessageService } from 'ng-zorro-antd/message';

import { OrderApi } from '@entities/order/api/order.api';
import type {
  Order,
  OrderCandidate,
  OrderEstimate,
  OrderLimit,
  OrderTerms,
} from '@entities/order/model/order.types';
import { SpecialistApi } from '@entities/specialist/api/specialist.api';
import type { SearchHit } from '@entities/specialist/model/specialist.types';
import {
  CANDIDATE_STATUS_LABEL,
  candidateTone,
  freeSlots as slotsLeft,
} from '@entities/order/lib/order-status';
import { formatMoney, groupDigits, monthLabel } from '@entities/billing/lib/money';
import { parseApiError } from '@shared/api/api-error';
import { AppHeaderComponent } from '@widgets/app-header/app-header.component';

/**
 * Воронка заказа «под ключ» глазами заказчика.
 *
 * Разметка перенесена из макета ~/tmp/crm_funnel_creators.html. Шаги —
 * не вкладки: человек идёт по ним один раз и в одну сторону, поэтому
 * состояние шага держится не в URL, а в заказе. Пока заказа нет, шаг
 * живёт в компоненте; как только он создан — читается из его статуса, и
 * страницу можно закрыть и вернуться по ссылке /me/orders/:id.
 *
 * Три правила домена интерфейс обязан уважать, и ни одно из них он не
 * проверяет сам — их проверяет сервер:
 *   • приглашение уходит только на реально свободное место, живёт 72
 *     часа, и освободившееся место достаётся следующему по приоритету;
 *   • заказ создаётся только с согласием на действующую версию правил и
 *     навсегда остаётся на ней;
 *   • лимит креаторов считается на МЕСЯЦ СТАРТА, а не на сегодня.
 * Интерфейс их не нарушает и, что важнее, не предлагает нарушить:
 * недоступного кандидата нельзя выбрать, а не «выбрать и получить 409».
 */

/** Категории каталога, из которых собирается пакет блогеров. */
const CREATOR_CATEGORIES = ['blogger', 'ugc'];

const CATEGORY_LABEL: Record<string, string> = {
  blogger: 'Блогер',
  ugc: 'UGC',
};

/** Подписи шагов — те же, что в макете. */
const STEP_LABELS = ['Вид проекта', 'Подбор', 'Ответы', 'Добор', 'Оплата', 'Проект'];

@Component({
  selector: 'app-order-funnel-page',
  standalone: true,
  imports: [CommonModule, FormsModule, AppHeaderComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './order-funnel.page.html',
  styleUrl: './order-funnel.page.scss',
})
export class OrderFunnelPage implements OnInit {
  private readonly api = inject(OrderApi);

  private readonly catalogApi = inject(SpecialistApi);

  private readonly route = inject(ActivatedRoute);

  private readonly router = inject(Router);

  private readonly msg = inject(NzMessageService);

  private readonly destroyRef = inject(DestroyRef);

  public readonly stepLabels = STEP_LABELS;

  /** Шаг, на котором стоит человек. У созданного заказа его диктует статус. */
  public readonly step = signal(0);

  // ---- подбор ----

  public readonly catalog = signal<SearchHit[]>([]);

  public readonly catalogLoading = signal(false);

  public readonly query = signal('');

  public readonly category = signal('');

  /**
   * Подборка — В ПОРЯДКЕ ПРИОРИТЕТА, а не в порядке кликов. Порядок этих
   * строк уходит на сервер как есть: приглашения идут по нему сверху вниз.
   */
  public readonly picked = signal<string[]>([]);

  /**
   * Всё, что мы знаем о людях в подборке. Отдельно от каталога: человек
   * остаётся в подборке и после того, как фильтр убрал его из выдачи, —
   * иначе смена фильтра молча меняла бы состав заказа.
   */
  private readonly known = new Map<string, SearchHit>();

  /** Кто занят в выбранном месяце. Такого нельзя даже отметить. */
  public readonly busy = signal<ReadonlySet<string>>(new Set());

  public readonly month = signal(currentMonth());

  public readonly months = nextMonths(6);

  public readonly videos = signal(30);

  /** Объём задали руками — тогда перестаём подставлять его сами. */
  private videosTouched = false;

  public readonly limit = signal<OrderLimit | null>(null);

  public readonly terms = signal<OrderTerms | null>(null);

  public readonly consented = signal(false);

  /** Галка согласия в форме. Отдельно от consented: её ставят сейчас. */
  public agreed = false;

  public readonly estimate = signal<OrderEstimate | null>(null);

  public readonly estimating = signal(false);

  public readonly submitting = signal(false);

  // ---- заказ ----

  public readonly order = signal<Order | null>(null);

  public readonly orderEstimate = signal<OrderEstimate | null>(null);

  public readonly busyOrder = signal(false);

  /**
   * Сколько человек зовём. Не поле ввода: лимит месяца — это потолок, а
   * меньше него клиент и так берёт ровно столько, сколько отметил.
   */
  public readonly allowed = computed(() => this.limit()?.allowed ?? 1);

  public readonly needed = computed(() => Math.min(this.picked().length, this.allowed()));

  /** Первые needed — их зовут сразу. */
  public readonly team = computed(() => this.picked().slice(0, this.needed()));

  /**
   * Остальные — резерв. Место освобождается отказом или молчанием, и
   * тогда приглашение уходит следующему отсюда, уже без участия клиента.
   */
  public readonly reserve = computed(() => this.picked().slice(this.needed()));

  public readonly overLimit = computed(() => this.reserve().length > 0);

  constructor() {
    // Смета пересчитывается на каждое изменение состава и объёма. Эффект
    // заводим здесь, а не в ngOnInit: там нет контекста внедрения.
    effect(() => {
      const ids = this.picked();
      const needed = this.needed();
      const videos = this.videos();
      untracked(() => this.scheduleEstimate(ids, needed, videos));
    });
    this.destroyRef.onDestroy(() => {
      if (this.estimateTimer) clearTimeout(this.estimateTimer);
    });
  }

  public ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('id');
    if (id) {
      this.loadOrder(id, true);
      return;
    }
    this.loadTerms();
    this.loadLimit();
    this.loadCatalog();
  }

  // ---- шаг 0: вид проекта ----

  public chooseCreators(): void {
    this.step.set(1);
  }

  /**
   * Вторая ветка — другой экран, которого ещё нет. Показываем это прямо,
   * а не ведём в пустую страницу: «скоро» честнее, чем 404.
   */
  public readonly productionAsked = signal(false);

  public chooseProduction(): void {
    this.productionAsked.set(true);
  }

  // ---- шаг 1: подбор ----

  private loadCatalog(): void {
    this.catalogLoading.set(true);
    const chosen = this.category();
    this.catalogApi
      .search({
        q: this.query() || undefined,
        categories: chosen ? [chosen] : CREATOR_CATEGORIES,
        limit: 50,
      })
      .subscribe({
        next: (r) => {
          for (const hit of r.items) this.known.set(hit.user_id, hit);
          this.catalog.set(r.items);
          this.catalogLoading.set(false);
          this.loadBusy();
        },
        error: (e) => {
          this.catalogLoading.set(false);
          this.msg.error(parseApiError(e, 'Не удалось загрузить каталог.').message);
        },
      });
  }

  public applyFilters(): void {
    this.loadCatalog();
  }

  /**
   * Занятость — на месяц старта. Спрашиваем про весь каталог сразу:
   * иначе первым в списке окажется тот, кто взять не может, и заказ
   * провисит трое суток впустую.
   */
  private loadBusy(): void {
    const ids = [...new Set([...this.catalog().map((c) => c.user_id), ...this.picked()])];
    if (ids.length === 0) return;
    this.api.busyCreators(this.month(), ids).subscribe({
      next: (r) => {
        const set = new Set(r.busy);
        this.busy.set(set);
        // Занятого выкидываем из подборки сам: оставить его значит
        // предложить заказ, который сервер не примет.
        const kept = this.picked().filter((id) => !set.has(id));
        if (kept.length !== this.picked().length) this.picked.set(kept);
      },
      error: () => {
        // Занятость — подсказка, а не право на заказ: её проверяет сервер
        // при создании. Молчим, чтобы не пугать сообщением ни о чём.
      },
    });
  }

  private loadLimit(): void {
    this.api.limit(this.month()).subscribe({
      next: (l) => this.limit.set(l),
      error: (e) => this.msg.error(parseApiError(e, 'Не удалось узнать лимит.').message),
    });
  }

  private loadTerms(): void {
    this.api.terms().subscribe({
      next: (r) => {
        this.terms.set(r.terms);
        this.consented.set(r.consented);
        this.agreed = r.consented;
        if (!this.videosTouched) this.suggestVideos();
      },
      error: (e) => this.msg.error(parseApiError(e, 'Не удалось загрузить условия.').message),
    });
  }

  public changeMonth(month: string): void {
    this.month.set(month);
    this.loadLimit();
    this.loadBusy();
  }

  public setVideos(value: number): void {
    this.videosTouched = true;
    this.videos.set(Math.max(1, Math.trunc(value) || 1));
  }

  /**
   * Объём по умолчанию — оклад назван за него: столько роликов на
   * креатора первый месяц, и умножить надо на состав, а не оставить как
   * есть при трёх людях.
   */
  private suggestVideos(): void {
    const perCreator = this.terms()?.videos_first_month || 30;
    this.videos.set(perCreator * Math.max(1, this.needed()));
  }

  public toggle(id: string): void {
    if (this.busy().has(id)) return;
    const cur = this.picked();
    this.picked.set(cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]);
    if (!this.videosTouched) this.suggestVideos();
  }

  public isPicked(id: string): boolean {
    return this.picked().includes(id);
  }

  /** Приоритет меняется перестановкой: выше в списке — раньше позовут. */
  public move(id: string, delta: number): void {
    const cur = [...this.picked()];
    const from = cur.indexOf(id);
    const to = from + delta;
    if (from < 0 || to < 0 || to >= cur.length) return;
    [cur[from], cur[to]] = [cur[to], cur[from]];
    this.picked.set(cur);
  }

  public name(id: string): string {
    return this.known.get(id)?.display_name ?? id.slice(0, 8);
  }

  /**
   * Подпись под карточкой. Берём именно креаторскую категорию, а не
   * основную: у монтажёра, который вдобавок снимает UGC, основная —
   * «видеоредактор», и в пакет блогеров он попадает не ею.
   */
  public role(hit: SearchHit): string {
    const own = hit.categories ?? [];
    const code =
      own.find((c) => CREATOR_CATEGORIES.includes(c)) ?? hit.primary_category ?? own[0] ?? '';
    const label = CATEGORY_LABEL[code] ?? code;
    return hit.city ? `${label} · ${hit.city}` : label;
  }

  /**
   * Смета пересчитывается на КАЖДОЕ изменение состава и объёма.
   *
   * С задержкой: отметить трёх человек подряд — три запроса, из которых
   * нужен последний. Ответы приходят не в том порядке, в каком уходили,
   * поэтому старые отбрасываем по номеру, а не «кто последний записал».
   */
  private estimateSeq = 0;

  private estimateTimer: ReturnType<typeof setTimeout> | null = null;

  private estimateKey = '';

  private scheduleEstimate(ids: string[], needed: number, videos: number): void {
    if (this.estimateTimer) clearTimeout(this.estimateTimer);
    if (ids.length === 0 || needed < 1 || videos < 1) {
      this.estimateKey = '';
      this.estimate.set(null);
      this.estimating.set(false);
      return;
    }
    // На сумму влияет состав, а не приоритет: перестановка строк меняет
    // очередь приглашений и ничего больше. Считать по ней смету заново
    // значит гасить уже показанное число ради того же самого ответа.
    const key = `${[...ids].sort().join(',')}|${needed}|${videos}`;
    if (key === this.estimateKey && this.estimate()) return;
    this.estimateKey = key;
    this.estimating.set(true);
    const seq = ++this.estimateSeq;
    this.estimateTimer = setTimeout(() => {
      this.api.draftEstimate({ needed, videos_count: videos, creator_ids: ids }).subscribe({
        next: (e) => {
          if (seq !== this.estimateSeq) return;
          this.estimate.set(e);
          this.estimating.set(false);
        },
        error: (err) => {
          if (seq !== this.estimateSeq) return;
          this.estimating.set(false);
          this.estimate.set(null);
          this.msg.error(parseApiError(err, 'Не удалось посчитать смету.').message);
        },
      });
    }, 250);
  }

  public canSubmit(): boolean {
    return this.picked().length > 0 && (this.consented() || this.agreed) && !this.submitting();
  }

  /**
   * Оформить: согласие → заказ → приглашения.
   *
   * Согласие отдельным запросом и до создания: заказ навсегда остаётся на
   * той версии правил, под которой стоит подпись, и создать его «а
   * согласие потом» нельзя — сервер ответит no_consent.
   */
  public submit(): void {
    if (!this.canSubmit()) return;
    this.submitting.set(true);
    if (!this.consented()) {
      this.api.consent().subscribe({
        next: () => {
          this.consented.set(true);
          this.create();
        },
        error: (e) => {
          this.submitting.set(false);
          this.msg.error(parseApiError(e, 'Не удалось принять условия.').message);
        },
      });
      return;
    }
    this.create();
  }

  private create(): void {
    this.api
      .createOrder({
        start_month: this.month(),
        needed: this.needed(),
        videos_count: this.videos(),
        creator_ids: this.picked(),
      })
      .subscribe({
        next: (res) => {
          // Приглашения — вторым запросом: заказ создаётся черновиком,
          // и до этого шага никого ещё не побеспокоили.
          this.api.invite(res.order.id).subscribe({
            next: (o) => {
              this.submitting.set(false);
              this.applyOrder(o);
              this.router.navigate(['/me/orders', o.id], { replaceUrl: true });
            },
            error: (e) => {
              this.submitting.set(false);
              this.applyOrder(res.order);
              this.msg.error(parseApiError(e, 'Заказ создан, но приглашения не ушли.').message);
            },
          });
        },
        error: (e) => {
          this.submitting.set(false);
          this.msg.error(parseApiError(e, 'Не удалось создать заказ.').message);
        },
      });
  }

  // ---- шаги 2–5: заказ ----

  private loadOrder(id: string, initial = false): void {
    this.busyOrder.set(true);
    this.api.getOrder(id).subscribe({
      next: (o) => {
        this.busyOrder.set(false);
        this.applyOrder(o);
        if (initial) this.loadTerms();
      },
      error: (e) => {
        this.busyOrder.set(false);
        this.msg.error(parseApiError(e, 'Заказ не найден.').message);
        this.router.navigate(['/me/projects']);
      },
    });
  }

  private applyOrder(o: Order): void {
    this.order.set(o);
    this.step.set(stepOf(o));
    this.api.orderEstimate(o.id).subscribe({
      next: (e) => this.orderEstimate.set(e),
      error: () => this.orderEstimate.set(null),
    });
  }

  public refresh(): void {
    const o = this.order();
    if (o) this.loadOrder(o.id);
  }

  /** Свободные места: сколько ещё нужно согласий. */
  public freeSlots(o: Order): number {
    return slotsLeft(o);
  }

  public gotoTopUp(): void {
    this.step.set(3);
  }

  public backToWaiting(): void {
    this.step.set(2);
  }

  /**
   * Позвать следующих по приоритету. Ручка не «пригласить кого хочу»:
   * сервер сам берёт из резерва столько, сколько мест реально свободно.
   */
  public inviteNext(): void {
    const o = this.order();
    if (!o) return;
    this.busyOrder.set(true);
    this.api.invite(o.id).subscribe({
      next: (updated) => {
        this.busyOrder.set(false);
        this.applyOrder(updated);
      },
      error: (e) => {
        this.busyOrder.set(false);
        this.msg.error(parseApiError(e, 'Не удалось позвать следующих.').message);
      },
    });
  }

  public cancel(): void {
    const o = this.order();
    if (!o) return;
    this.busyOrder.set(true);
    this.api.cancelOrder(o.id).subscribe({
      next: (updated) => {
        this.busyOrder.set(false);
        this.applyOrder(updated);
        this.msg.success('Заказ отменён.');
      },
      error: (e) => {
        this.busyOrder.set(false);
        this.msg.error(parseApiError(e, 'Не удалось отменить заказ.').message);
      },
    });
  }

  public openProject(): void {
    const id = this.order()?.project_id;
    if (id) this.router.navigate(['/me/projects', id]);
  }

  // ---- подписи ----

  public statusLabel(s: OrderCandidate['status']): string {
    return CANDIDATE_STATUS_LABEL[s];
  }

  /** Класс строки: цвет — это её состояние, а не украшение. */
  public invClass(s: OrderCandidate['status']): string {
    return candidateTone(s);
  }

  public money(kopecks: number | null | undefined): string {
    return formatMoney(kopecks);
  }

  public views(n: number): string {
    return groupDigits(n);
  }

  public monthName(key: string): string {
    return monthLabel(key.slice(0, 7));
  }

  public initial(name: string): string {
    return (name || '?').trim().slice(0, 1).toUpperCase();
  }

  /** Аватарный градиент макета: пять штук, разбираются по имени. */
  public avatarClass(seed: string): string {
    let sum = 0;
    for (const ch of seed) sum += ch.charCodeAt(0);
    return `a${(sum % 5) + 1}`;
  }
}

/** Шаг воронки по статусу заказа: заказ и есть источник правды. */
function stepOf(o: Order): number {
  if (o.status === 'paid') return 5;
  if (o.status === 'staffed') return 4;
  return 2;
}

function currentMonth(now: Date = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

/** Месяц старта — только текущий и будущие: в прошлое заказ не заводят. */
function nextMonths(n: number, now: Date = new Date()): string[] {
  const out: string[] = [];
  for (let i = 0; i < n; i += 1) {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  return out;
}
