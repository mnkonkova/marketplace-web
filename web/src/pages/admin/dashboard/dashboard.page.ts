import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { Params, Router, RouterLink } from '@angular/router';

import { AdminApi } from '@entities/admin/api/admin.api';
import { AdminSummaryStore } from '@entities/admin/model/admin-summary.store';
import {
  AttentionBlock,
  AttentionKey,
  AuditEntry,
  TeamMember,
} from '@entities/admin/model/admin-shell.types';
import { AUDIT_ACTION_LABEL } from '@entities/admin/lib/audit-labels';
import { PROJECT_KIND_LABEL, PROJECT_STATUS_LABEL } from '@shared/lib/project-status';
import { formatAgo, plural } from '@shared/lib/format';
import { CrmIconComponent, CrmIconName } from '@shared/ui/crm-icon/crm-icon.component';
import { ListStateComponent } from '@shared/ui/list-state/list-state.component';
import { PageHeadComponent } from '@shared/ui/page-head/page-head.component';

/** Как выглядит и куда ведёт один повод зайти в админку сегодня. */
interface AttentionSpec {
  key: AttentionKey;
  icon: CrmIconName;
  /** Цвет — по срочности: красное сломалось, янтарное ждёт нас, синее к сведению. */
  tone: 'bad' | 'warn' | 'info';
  title: string;
  /** Подпись кнопки — глагол: «Открыть очередь», а не «Перейти». */
  action: string;
  /** Куда ведёт: раздел и фильтры, под которыми видно ровно эти строки. */
  link: string;
  query?: Params;
  /** Что написать, когда здесь чисто. Собирается в строку «Спокойно: …». */
  calm: string;
}

/**
 * Порядок — по тому, насколько поздно узнать. Просроченные выкладки и
 * непринятые решения стоят первыми: их цена растёт каждый день. Деньги и
 * лимиты — ниже: они не портятся от суток ожидания.
 */
const ATTENTION: AttentionSpec[] = [
  {
    key: 'publications_overdue',
    icon: 'alert',
    tone: 'bad',
    title: 'Просрочены выкладки',
    action: 'Открыть проекты',
    link: '/admin/projects',
    query: { kind: 'creators_turnkey' },
    calm: 'выкладки выходят по плану',
  },
  {
    key: 'moderation',
    icon: 'shield',
    tone: 'warn',
    title: 'Модерация',
    action: 'Открыть очередь',
    link: '/admin/moderation',
    calm: 'очередь модерации пуста',
  },
  {
    key: 'projects_unassigned',
    icon: 'user',
    tone: 'warn',
    title: 'Без менеджера',
    action: 'Назначить',
    link: '/admin/projects',
    query: { manager: 'none' },
    calm: 'у всех проектов есть ответственный',
  },
  {
    key: 'projects_stale',
    icon: 'clock',
    tone: 'warn',
    title: 'Без движения 7+ дней',
    action: 'Показать',
    link: '/admin/projects',
    query: { sort: 'updated_asc' },
    calm: 'все проекты двигались на этой неделе',
  },
  {
    key: 'managers_unapproved',
    icon: 'team',
    tone: 'warn',
    title: 'Менеджеры без доступа',
    action: 'Открыть команду',
    link: '/admin/team',
    calm: 'неодобренных менеджеров нет',
  },
  {
    key: 'specialist_not_confirmed',
    icon: 'spec',
    tone: 'warn',
    title: 'Клиент выбрал специалиста, менеджер не подтвердил',
    action: 'Открыть проекты',
    link: '/admin/projects',
    calm: 'выбор клиентов подтверждён',
  },
  {
    key: 'work_without_prepayment',
    icon: 'ruble',
    tone: 'info',
    title: 'Работа идёт без подтверждённой предоплаты',
    action: 'Открыть проекты',
    link: '/admin/projects',
    calm: 'работа без предоплаты не идёт',
  },
  {
    key: 'revisions_exceeded',
    icon: 'repeat',
    tone: 'warn',
    title: 'Превышен лимит правок',
    action: 'Показать',
    link: '/admin/projects',
    calm: 'лимит правок никто не превысил',
  },
];

/** Сколько человек помещается в карточку нагрузки, не становясь списком. */
const LOADS_SHOWN = 8;

/** Цвет статуса в полосе распределения. Порядок — как в жизни проекта. */
const STATUS_ORDER = ['draft', 'active', 'on_hold', 'dispute', 'done', 'cancelled'] as const;

const STATUS_COLOR: Record<string, string> = {
  draft: 'var(--text-dim)',
  active: 'var(--info)',
  on_hold: 'var(--border-hover)',
  dispute: 'var(--warn)',
  done: 'var(--ok)',
  cancelled: 'var(--bad)',
};

const STATUS_LABEL: Record<string, string> = {
  draft: 'Черновик',
  active: 'В работе',
  on_hold: 'На паузе',
  dispute: 'Спор',
  done: 'Завершён',
  cancelled: 'Отменён',
};

interface AttentionRow extends AttentionSpec {
  block: AttentionBlock;
  /** Готовая строка-пояснение из первых items — что именно ждёт. */
  note: string;
}

interface BranchRow {
  kind: string;
  label: string;
  total: number;
  parts: { status: string; label: string; color: string; count: number }[];
}

/**
 * Сводка — первое, что видит админ.
 *
 * Была четырьмя плитками KPI и разрезом по воронкам: цифры красивые, но
 * ни одна не говорила, что делать. «Всего проектов 17» — это не задача.
 * Теперь экран отвечает на один вопрос: что требует вас сегодня, — и
 * каждая строка ведёт в список, отфильтрованный ровно под неё.
 *
 * Пустые блоки не выкидываются, а собираются в строку «Спокойно: …»:
 * исчезнувший блок читается как «не посчитали», а не как «там чисто».
 */
@Component({
  selector: 'app-admin-dashboard-page',
  standalone: true,
  imports: [CommonModule, RouterLink, CrmIconComponent, ListStateComponent, PageHeadComponent],
  templateUrl: './dashboard.page.html',
  styleUrl: './dashboard.page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdminDashboardPage implements OnInit {
  private readonly summary = inject(AdminSummaryStore);

  private readonly router = inject(Router);

  private readonly api = inject(AdminApi);

  public readonly loading = this.summary.loading;

  public readonly error = this.summary.error;

  public readonly generatedAt = computed(() => this.summary.data()?.generated_at ?? '');

  /** Сегодняшняя дата словами — она же говорит, за какой день сводка. */
  public readonly today = computed(() => {
    const iso = this.generatedAt();
    const d = iso ? new Date(iso) : new Date();
    return d.toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' });
  });

  /** Блоки, где есть что разбирать. Порядок фиксированный (см. ATTENTION). */
  public readonly rows = computed<AttentionRow[]>(() => {
    const a = this.summary.data()?.attention;
    if (!a) return [];
    return ATTENTION.map((spec) => ({
      ...spec,
      block: a[spec.key],
      note: noteOf(a[spec.key]),
    })).filter((r) => r.block && r.block.count > 0);
  });

  /** Сколько поводов, а не сколько строк во всех сразу: «58» рядом с
   *  заголовком читалось бы как одна большая беда вместо шести разных. */
  public readonly total = computed(() => this.rows().length);

  /** Строка «Спокойно: …» — перечисляет ровно то, где чисто. */
  public readonly calm = computed(() => {
    const a = this.summary.data()?.attention;
    if (!a) return '';
    const quiet = ATTENTION.filter((s) => !a[s.key] || a[s.key].count === 0).map((s) => s.calm);
    if (!quiet.length) return '';
    return `Спокойно: ${quiet.join(', ')}.`;
  });

  public readonly branches = computed<BranchRow[]>(() => {
    const d = this.summary.data();
    if (!d) return [];
    // Ветки — по видам проектов. «Общий проект» показываем только когда
    // он есть: заводят его редко, и пустая ветка занимала бы строку.
    return Object.entries(d.projects_by_kind)
      .filter(([, n]) => n > 0)
      .map(([kind, total]) => ({
        kind,
        label: PROJECT_KIND_LABEL[kind as keyof typeof PROJECT_KIND_LABEL] ?? kind,
        total,
        parts: [],
      }));
  });

  /**
   * Распределение по статусам — общее на все ветки.
   *
   * Сводка отдаёт срез по видам и срез по статусам порознь, пересечения
   * в ней нет. Рисовать полосу внутри каждой ветки было бы враньём:
   * числа взялись бы из другого разреза.
   */
  public readonly statusParts = computed(() => {
    const by = this.summary.data()?.projects_by_status;
    if (!by) return [];
    return STATUS_ORDER.filter((s) => (by[s] ?? 0) > 0).map((s) => ({
      status: s as string,
      label: STATUS_LABEL[s] ?? PROJECT_STATUS_LABEL[s as never] ?? s,
      color: STATUS_COLOR[s] ?? 'var(--border-hover)',
      count: by[s] ?? 0,
    }));
  });

  public readonly statusTotal = computed(() => this.statusParts().reduce((n, p) => n + p.count, 0));

  /**
   * Нагрузка: менеджеры, самые загруженные сверху.
   *
   * Карточка отвечает на «кому уже некуда» — значит первыми идут те, у
   * кого работы больше. Показываем первых восемь: в команде их тридцать,
   * и полный список здесь превращает карточку в отдельный экран, у
   * которого уже есть свой адрес.
   */
  private readonly managersByLoad = computed(() =>
    (this.summary.data()?.managers ?? [])
      .filter((t) => t.is_manager || t.active_projects > 0)
      .slice()
      .sort(
        (a, b) => b.active_projects - a.active_projects || this.name(a).localeCompare(this.name(b)),
      ),
  );

  public readonly loads = computed(() => {
    const all = this.managersByLoad();
    const max = Math.max(1, ...all.map((t) => t.active_projects));
    return all
      .slice(0, LOADS_SHOWN)
      .map((t) => ({ member: t, percent: Math.round((t.active_projects / max) * 100) }));
  });

  /** Сколько человек не поместилось — за ними в «Команду». */
  public readonly loadsRest = computed(() =>
    Math.max(0, this.managersByLoad().length - LOADS_SHOWN),
  );

  /**
   * Журнал: последние записи. Отдельным запросом — в сводку он не входит,
   * и тащить его туда значило бы грузить ленту ради счётчиков сайдбара,
   * которые просит та же ручка.
   */
  public readonly log = signal<AuditEntry[]>([]);

  public ngOnInit(): void {
    this.summary.ensure();
    this.api.listAudit({ limit: 5 }).subscribe({
      next: (r) => this.log.set(r.items ?? []),
      // Журнал — приложение к сводке: без него экран остаётся рабочим,
      // и своей ошибки он не заслуживает.
      error: () => this.log.set([]),
    });
  }

  public retry(): void {
    this.summary.reload();
  }

  public name(t: TeamMember): string {
    return t.display_name || t.email || t.user_id;
  }

  public initial(t: TeamMember): string {
    return (this.name(t).trim().charAt(0) || '·').toUpperCase();
  }

  public projectsWord(n: number): string {
    return plural(n, 'проект', 'проекта', 'проектов');
  }

  public actionLabel(a: AuditEntry): string {
    return AUDIT_ACTION_LABEL[a.action] ?? a.action;
  }

  public ago(iso: string): string {
    return formatAgo(iso);
  }

  public open(row: AttentionRow): void {
    void this.router.navigate([row.link], { queryParams: row.query ?? {} });
  }
}

/**
 * Пояснение к блоку: первые строки, которые прислал сервер.
 *
 * Формулировки берём его — «12 дн. без движения» он посчитал по тем же
 * данным, что и count. Своя версия здесь означала бы второе место, где
 * это считается, и первое же расхождение выглядело бы как ошибка в
 * цифре.
 */
function noteOf(block: AttentionBlock | undefined): string {
  if (!block?.items?.length) return '';
  return block.items
    .slice(0, 3)
    .map((i) => (i.note ? `${i.title} — ${i.note}` : i.title))
    .join(' · ');
}
