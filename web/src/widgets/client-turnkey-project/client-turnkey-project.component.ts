import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { NzMessageService } from 'ng-zorro-antd/message';

import { BackLinkComponent } from '@shared/nav/back-link.component';
import { downloadBlob } from '@shared/lib/download-blob';
import { parseApiError } from '@shared/api/api-error';
import { plural } from '@shared/lib/format';
import { BillingApi } from '@entities/billing/api/billing.api';
import { formatMoney, monthLabel } from '@entities/billing/lib/money';
import type { ProjectBilling } from '@entities/billing/model/billing.types';
import { PublicationApi } from '@entities/publication/api/publication.api';
import { projectBlocks } from '@entities/publication/lib/project-blocks';
import {
  PLATFORM_LABEL,
  PLATFORM_SHORT,
  creatorLabel,
} from '@entities/publication/lib/publication-status';
import { ALL_PLATFORMS } from '@entities/publication/model/publication.types';
import type {
  CalendarDay,
  ClientVideo,
  NotificationPrefs,
  Platform,
  PublicationReport,
  VideoRow,
} from '@entities/publication/model/publication.types';
import type { ProjectClientView } from '@entities/project/model/project.types';
import { ProjectBillingComponent } from '@widgets/project-billing/project-billing.component';
import { ProjectCalendarComponent } from '@widgets/project-calendar/project-calendar.component';
import { ProjectCommentsComponent } from '@widgets/project-comments/project-comments.component';
import { ProjectStatsComponent } from '@widgets/project-stats/project-stats.component';

/**
 * Проект «креаторы под ключ» глазами заказчика.
 *
 * Отдельный компонент, а не ветка в странице проекта: это другой экран, а
 * не вариант того же. У проекта с воронкой — стадии, шаги и согласования;
 * здесь — ролики, площадки, цифры и деньги. Общего между ними ровно
 * заголовок, и держать оба вида в одном шаблоне значит каждый раз читать
 * половину чужой разметки.
 *
 * Разметка перенесена из макета ~/tmp/crm_project_client (1).html.
 */
@Component({
  selector: 'app-client-turnkey-project',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    NzIconModule,
    BackLinkComponent,
    ProjectBillingComponent,
    ProjectCalendarComponent,
    ProjectCommentsComponent,
    ProjectStatsComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './client-turnkey-project.component.html',
  styleUrl: './client-turnkey-project.component.scss',
})
export class ClientTurnkeyProjectComponent {
  private readonly pubApi = inject(PublicationApi);

  private readonly billingApi = inject(BillingApi);

  private readonly msg = inject(NzMessageService);

  /** Проект уже загружен страницей — второй раз его не тянем. */
  public readonly project = input.required<ProjectClientView>();

  public readonly meId = input<string>('');

  /** Раскрытые ролики: разбор по площадкам открывается по требованию. */
  public readonly openVideos = signal<ReadonlySet<string>>(new Set<string>());

  public toggleVideo(id: string): void {
    const next = new Set(this.openVideos());
    if (!next.delete(id)) next.add(id);
    this.openVideos.set(next);
  }

  public isVideoOpen(id: string): boolean {
    return this.openVideos().has(id);
  }

  /**
   * Строки площадок ролика: ссылка, просмотры, прирост за сутки и ER.
   *
   * Берём из отчёта, который на этой странице уже загружен: в ленте
   * роликов есть только суммы по ролику, а разбор по площадкам —
   * единственное, ради чего заказчик её и раскрывает.
   */
  public platformRows(v: ClientVideo): VideoRow[] {
    const rows = this.report()?.videos_table ?? [];
    return rows.filter((r) => r.publication_id === v.publication_id);
  }

  /**
   * Ролик вышел не везде.
   *
   * Бейдж «N из 5 площадок» был зелёным всегда, и ролик, вышедший на двух
   * площадках, выглядел закрытым — это дезинформация, а не косметика:
   * именно по таким роликам менеджер и дожимает креатора.
   */
  public partial(v: ClientVideo): boolean {
    return this.platformsOf(v).length < ALL_PLATFORMS.length;
  }

  /** Имя креатора или внятная замена: uuid в ленте показывать нельзя. */
  public creatorName(name?: string): string {
    return creatorLabel(name);
  }

  /** Для какого проекта уже загружены лента, цифры и календарь. */
  private loadedFor = '';

  public constructor() {
    // Страница проекта опрашивает воронку раз в 30 секунд и каждый раз
    // кладёт в input НОВЫЙ объект. Без этой проверки эффект срабатывал на
    // каждый опрос: пять запросов в полминуты — и, что хуже, свежий ответ
    // clientPrefs затирал галочку уведомлений, которую пользователь
    // только что переключил и чей PUT ещё летел.
    effect(() => {
      const id = this.project().id;
      if (!id || id === this.loadedFor) return;
      this.loadedFor = id;
      this.load(id);
    });
  }

  // ---- выкладки: лента, цифры, календарь, уведомления ----
  //
  // Эти блоки есть только у проектов «креаторы под ключ». Раньше это
  // определялось по данным — пустая лента при пустом календаре считалась
  // проектом по воронке, — и новый проект без проставленных дат выглядел
  // так же. Теперь вид проекта приходит полем kind.

  /** Сколько площадок в проекте. В разметке «5» стояло числом. */
  public readonly platformCount = ALL_PLATFORMS.length;

  public plural(n: number, one: string, few: string, many: string): string {
    return plural(n, one, few, many);
  }

  public readonly platformLabel = PLATFORM_LABEL;

  public readonly platformShort = PLATFORM_SHORT;

  public readonly videos = signal<ClientVideo[]>([]);

  public readonly calendarDays = signal<CalendarDay[]>([]);

  public readonly calendarMonth = signal(currentMonth());

  public readonly report = signal<PublicationReport | null>(null);

  // Показ статистики выключен настройкой проекта: бэк отвечает 404 и на
  // отчёт, и на цифры в ленте (там же приходит stats_hidden).
  public readonly statsDenied = signal(false);

  public readonly prefs = signal<NotificationPrefs | null>(null);

  public readonly chartRange = signal<7 | 30>(30);

  public readonly blocks = computed(() => {
    const p = this.project();
    return projectBlocks('client', { kind: p.kind, statsAllowed: !this.statsDenied() });
  });

  public readonly csvBusy = signal(false);

  /**
   * Деньги проекта. В макете они разложены по трём местам сразу — плитка
   * «К оплате», карточки тарифа и состав месяца, — поэтому запрос делает
   * страница, а не отдельный виджет: иначе одни и те же данные грузились
   * бы трижды и расходились между блоками.
   */
  public readonly billing = signal<ProjectBilling | null>(null);

  /** Суммы приходят в копейках. */
  public readonly money = formatMoney;

  /**
   * Оклад один или их несколько: при одном креаторе «Оклады» — ошибка
   * согласования, читатель ищет вторую строку, которой нет.
   */
  public readonly salaryTitle = computed(() =>
    (this.billing()?.accruals ?? []).length === 1 ? 'Оклад' : 'Оклады',
  );

  /** Месяц счёта словами: «сентябрь 2026». Период считает сервер. */
  public readonly monthTitle = computed(() => {
    const m = this.billing()?.period_month;
    return m ? monthLabel(m.slice(0, 7)) : '';
  });

  /**
   * Команда собрана автоматически по приоритету, а не выбрана вручную.
   * Приоритет есть только у проектов, выросших из заказа, — подпись
   * «собрана по вашему приоритету» без него была бы неправдой.
   */
  public readonly fromOrder = computed(() =>
    (this.billing()?.accruals ?? []).some((a) => (a.priority ?? 0) > 0),
  );

  /** Переписка внизу страницы: «Написать менеджеру» ведёт туда же. */
  public scrollToTalk(): void {
    document.getElementById('talk')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // Выгрузка тянется запросом с токеном и сохраняется из памяти: прежняя
  // ссылка в <a href> Bearer не несёт и открывала вкладку с 401.
  public downloadCsv(): void {
    const p = this.project();
    this.csvBusy.set(true);
    this.pubApi.clientReportCsv(p.id).subscribe({
      next: (blob) => {
        this.csvBusy.set(false);
        downloadBlob(blob, `report-${p.id}.csv`);
      },
      error: (e) => {
        this.csvBusy.set(false);
        this.msg.error(parseApiError(e, 'Не удалось выгрузить отчёт.').message);
      },
    });
  }

  public setRange(days: 7 | 30): void {
    this.chartRange.set(days);
  }

  public onMonthChange(month: string): void {
    this.calendarMonth.set(month);
    const p = this.project();
    if (p) this.loadCalendar(p.id, month);
  }

  public platformsOf(v: ClientVideo): Platform[] {
    return v.platforms ?? [];
  }

  public togglePref(field: 'on_new_video' | 'on_weekly_digest' | 'on_date_shift'): void {
    const p = this.project();
    const current = this.prefs();
    if (!p || !current) return;
    const next = !current[field];
    // Оптимистично: переключатель отзывается сразу, а на ошибке
    // возвращается обратно — иначе он «залипает» на время запроса.
    this.prefs.set({ ...current, [field]: next });
    this.pubApi.clientSavePrefs(p.id, { [field]: next }).subscribe({
      next: (saved) => this.prefs.set(saved),
      error: (e) => {
        this.prefs.set(current);
        this.msg.error(parseApiError(e, 'Не удалось сохранить настройку.').message);
      },
    });
  }

  private loadCalendar(id: string, month: string): void {
    this.pubApi.clientCalendar(id, month).subscribe({
      next: (r) => this.calendarDays.set(r.days),
      error: () => this.calendarDays.set([]),
    });
  }

  private load(id: string): void {
    this.billingApi.clientBilling(id).subscribe({
      next: (b) => this.billing.set(b),
      // Тарифа у проекта может не быть — деньги тогда просто не
      // показываем, это не сбой.
      error: () => this.billing.set(null),
    });
    this.pubApi.clientVideos(id).subscribe({
      next: (r) => this.videos.set(r.items),
      error: () => this.videos.set([]),
    });
    this.pubApi.clientReport(id).subscribe({
      next: (r) => {
        this.report.set(r);
        this.statsDenied.set(false);
      },
      // 404 здесь означает и «не ваш проект», и «показ статистики
      // выключен» — бэк отвечает одинаково намеренно, чтобы перебором
      // нельзя было узнать, какие проекты существуют.
      error: () => this.statsDenied.set(true),
    });
    this.pubApi.clientPrefs(id).subscribe({
      next: (p) => this.prefs.set(p),
      error: () => this.prefs.set(null),
    });
    // untracked: месяц читаем как значение, а не как зависимость. Иначе
    // листание календаря перезапускало бы весь эффект — пять запросов
    // вместо одного, и календарь дважды.
    this.loadCalendar(
      id,
      untracked(() => this.calendarMonth()),
    );
  }
}

// Текущий месяц в формате ГГГГ-ММ — его же ждёт ручка календаря.
function currentMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
