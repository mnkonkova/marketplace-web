import { AdminProjectsParams } from '../api/project.api';
import {
  AdminProjectsSort,
  ProjectKind,
  ProjectManagerView,
  ProjectStatus,
} from '../model/project.types';

/**
 * Фильтры списка проектов живут в адресе.
 *
 * Раньше они лежали полями компонента: ссылку «вот эти двенадцать без
 * ответственного» переслать было нечем — адрес у всех состояний один, — а
 * F5 возвращал на чистый список. Сводка это уже ловила: её плашка «Без
 * менеджера» вела на `/admin/projects?unassigned=1`, и параметр никто не
 * читал — открывался обычный список со всеми проектами.
 *
 * Фильтрация при этом остаётся серверной: в адресе — то же, что уходит в
 * `GET /admin/projects`, просто записанное так, чтобы пережить перезагрузку.
 *
 * Исключение одно и оно временное — страница менеджера: её ручка
 * параметров не принимает, и отбор там идёт на месте, функцией
 * `selectProjects` ниже. Разбор адреса, наборы значений и правила отбора
 * при этом общие на обе страницы: иначе «Активные» у админа и у менеджера
 * начнут значить разное, и никто этого не заметит.
 */

/**
 * Статус в фильтре.
 *
 * '' — «Все статусы»: сервер отдаёт всё, кроме отменённых.
 * 'unfinished' — «Активные»: четыре незавершённых статуса одним набором.
 * Это единственное неточное значение, и оно же стоит по умолчанию: список
 * открывают, чтобы посмотреть работу, а не архив. Тот же набор считает
 * `nav_counts.projects_active` — иначе цифра у раздела и число строк под
 * ним расходятся, и это читается как поломка.
 *
 * Фильтруем по status проекта, а не по display_status: второй вычисляется
 * из шагов, и в SQL его нет.
 */
export type StatusFilter = '' | 'unfinished' | ProjectStatus;

/** Ветка: креаторы или продакшн. '' — обе. */
export type KindFilter = '' | ProjectKind;

/** 'none' — проекты без ответственного. Пустым это не выразить: пустое
 *  значит «любой менеджер». */
export type ManagerFilter = '' | 'none' | string;

/** Как показан список. Канбан — тот же раздел, а не соседний адрес. */
export type ProjectsView = 'list' | 'board';

export interface ProjectFilters {
  q: string;
  status: StatusFilter;
  kind: KindFilter;
  manager: ManagerFilter;
  sort: AdminProjectsSort;
  includeTest: boolean;
  view: ProjectsView;
  /** Номер страницы, с единицы — как его показывает пагинатор. */
  page: number;
  pageSize: number;
}

const SORTS: AdminProjectsSort[] = ['updated_asc', 'updated_desc', 'created_asc', 'created_desc'];

const STATUSES: ProjectStatus[] = ['draft', 'active', 'on_hold', 'dispute', 'done', 'cancelled'];

const KINDS: ProjectKind[] = ['creators_turnkey', 'brand_turnkey', 'production_turnkey', 'general'];

const PAGE_SIZES = [20, 50, 100];

/**
 * По умолчанию — самые давно обновлённые сверху. Список открывают ровно с
 * этим вопросом: что не двигалось и кто за это отвечает.
 */
export const DEFAULT_PROJECT_FILTERS: ProjectFilters = {
  q: '',
  status: 'unfinished',
  kind: '',
  manager: '',
  sort: 'updated_asc',
  // Тестовые по умолчанию скрыты: из-за них половина списка была
  // «тест т8т 1234», и настоящие проекты в нём терялись.
  includeTest: false,
  view: 'list',
  page: 1,
  pageSize: 20,
};

/**
 * Разбор статуса: 'all' — явные «Все статусы», остальное — точный статус.
 *
 * Незнакомое значение приводим к умолчанию, а не отправляем как есть:
 * ручка на неизвестный статус отвечает 500, а адрес с фильтрами теперь
 * ходит ссылками — опечатка в чужой ссылке роняла бы экран.
 */
function statusFromQuery(raw: string, fallback: StatusFilter): StatusFilter {
  if (raw === 'all') return '';
  if (raw === 'unfinished') return 'unfinished';
  return (STATUSES as string[]).includes(raw) ? (raw as ProjectStatus) : fallback;
}

/** Минимум того, что нужно от ActivatedRoute.snapshot.queryParamMap. */
export interface QueryReader {
  get(name: string): string | null;
}

export function parseProjectFilters(params: QueryReader): ProjectFilters {
  const d = DEFAULT_PROJECT_FILTERS;
  const status = params.get('status') ?? '';
  const kind = params.get('kind') ?? '';
  const sort = params.get('sort') ?? '';
  const size = Number(params.get('size'));
  const page = Number(params.get('page'));
  return {
    q: (params.get('q') ?? '').trim(),
    // 'all' в адресе — это «Все статусы»: пустое значение в query не
    // записать, оно исчезает вместе с параметром и читается как default.
    status: statusFromQuery(status, d.status),
    kind: (KINDS as string[]).includes(kind) ? (kind as ProjectKind) : d.kind,
    // Менеджера не проверяем по списку: он приходит uuid'ом, а список
    // менеджеров доезжает отдельным запросом и позже самого фильтра.
    manager: params.get('manager') ?? d.manager,
    sort: (SORTS as string[]).includes(sort) ? (sort as AdminProjectsSort) : d.sort,
    includeTest: params.get('test') === '1',
    view: params.get('view') === 'board' ? 'board' : 'list',
    page: Number.isInteger(page) && page > 0 ? page : d.page,
    // Чужой размер страницы ушёл бы в limit как есть: `size=100000`
    // означал бы «выгрузи всё» одним адресом из письма.
    pageSize: PAGE_SIZES.includes(size) ? size : d.pageSize,
  };
}

/**
 * Фильтры в query-параметры. Значения по умолчанию отдаём как null:
 * Angular выбрасывает такие из адреса, и `/admin/projects` остаётся
 * коротким, пока ничего не выбрано.
 */
export function projectFiltersToQuery(f: ProjectFilters): Record<string, string | null> {
  const d = DEFAULT_PROJECT_FILTERS;
  return {
    q: f.q.trim() || null,
    status: f.status === d.status ? null : f.status || 'all',
    kind: f.kind || null,
    manager: f.manager || null,
    sort: f.sort === d.sort ? null : f.sort,
    test: f.includeTest ? '1' : null,
    view: f.view === 'board' ? 'board' : null,
    page: f.page > 1 ? String(f.page) : null,
    size: f.pageSize === d.pageSize ? null : String(f.pageSize),
  };
}

/**
 * Фильтры в параметры ручки. Короче двух символов сервер поиск всё равно
 * игнорирует — не шлём, чтобы в запросе не было параметра, который ни на
 * что не влияет.
 */
export function projectFiltersToParams(f: ProjectFilters): AdminProjectsParams {
  const params: AdminProjectsParams = {
    sort: f.sort,
    limit: f.pageSize,
    offset: (f.page - 1) * f.pageSize,
  };
  const q = f.q.trim();
  if (q.length >= 2) params.q = q;
  // `unfinished` — единственное неточное значение статуса: четыре
  // незавершённых через IN. Тот же набор считает nav_counts.projects_active,
  // поэтому цифра у раздела равна total этого списка.
  if (f.status) params.status = f.status;
  if (f.kind) params.kind = f.kind;
  if (f.manager) params.manager = f.manager;
  if (f.includeTest) params.include_test = true;
  return params;
}

// ---- наборы значений для выпадашек ----
//
// Списки лежат здесь, а не в компоненте страницы: их читают обе страницы
// проектов, и вторая копия разошлась бы с первой на первой же правке —
// «Активные» у админа и у менеджера начали бы значить разное.

export interface FilterOption<T> {
  value: T;
  label: string;
}

/**
 * Статусы фильтра.
 *
 * «Активные» первым и по умолчанию: список открывают, чтобы посмотреть
 * работу, а не архив. Тот же набор считает счётчик в сайдбаре.
 */
export const STATUS_OPTIONS: FilterOption<StatusFilter>[] = [
  { value: 'unfinished', label: 'Активные' },
  { value: '', label: 'Все статусы' },
  { value: 'draft', label: 'Черновик' },
  { value: 'active', label: 'В работе' },
  { value: 'on_hold', label: 'На паузе' },
  { value: 'dispute', label: 'Спор' },
  { value: 'done', label: 'Завершён' },
  { value: 'cancelled', label: 'Отменён' },
];

/**
 * Статусы, которые есть смысл предлагать менеджеру.
 *
 * `GET /manager/projects` отдаёт только незавершённые (draft, active,
 * on_hold, dispute) — завершённых и отменённых в ответе нет вовсе.
 * Показывать «Завершён» там, где он всегда даёт пустой список, — то же
 * самое, что показывать сломанный фильтр: выбор есть, результата нет, и
 * человек винит себя.
 */
export const MANAGER_STATUS_OPTIONS: FilterOption<StatusFilter>[] = STATUS_OPTIONS.filter((o) =>
  ['unfinished', 'draft', 'active', 'on_hold', 'dispute'].includes(o.value),
);

export const KIND_OPTIONS: FilterOption<KindFilter>[] = [
  { value: '', label: 'Все ветки' },
  { value: 'creators_turnkey', label: 'Креаторы' },
  { value: 'brand_turnkey', label: 'Бренд' },
  { value: 'production_turnkey', label: 'Продакшн' },
  { value: 'general', label: 'Общие' },
];

export const SORT_OPTIONS: FilterOption<AdminProjectsSort>[] = [
  { value: 'updated_asc', label: 'Давно не двигались' },
  { value: 'updated_desc', label: 'Недавно обновлённые' },
  { value: 'created_desc', label: 'Сначала новые' },
  { value: 'created_asc', label: 'Сначала старые' },
];

/** Четыре незавершённых статуса — то же, что `unfinished` в SQL сервера. */
const UNFINISHED: ProjectStatus[] = ['draft', 'active', 'on_hold', 'dispute'];

/** Поиск короче двух символов сервер игнорирует — здесь то же правило. */
const MIN_QUERY = 2;

/**
 * Отбор проектов теми же правилами, что и на сервере.
 *
 * ЗАЧЕМ ОН ВООБЩЕ ЕСТЬ. У админа фильтрация серверная и этой функции не
 * нужна. У менеджера её нет: `GET /manager/projects` не принимает ни
 * одного параметра и отдаёт весь закреплённый набор разом (в репозитории
 * LIMIT 500). Пока это так, отобрать можно только на месте.
 *
 * ГРАНИЦА, ЗА КОТОРОЙ ЭТО СЛОМАЕТСЯ. Клиентский отбор честен ровно до тех
 * пор, пока ручка отдаёт ВЕСЬ набор. Появится у неё пагинация — и отбор
 * начнёт применяться к одной странице вместо всего набора: «Активных: 12»
 * будет значить «двенадцать активных на этой странице», а не в проектах
 * менеджера. Такое враньё не падает и не видно в логах, поэтому его надо
 * поймать сразу: как только в ответе появятся limit/offset/total, эта
 * функция со страницы менеджера обязана уйти.
 *
 * ПЕРЕЕЗД НА СЕРВЕР — замена одного вызова: вместо `selectProjects(items, f)`
 * в шаблоне список приходит уже отобранным, `projectFiltersToParams(f)`
 * уходит в ручку. Разметку и адрес это не трогает.
 *
 * Правила один в один с `Repo.ListAll` в marketplace-api: незавершённые
 * четвёркой, пустой статус — «всё, кроме отменённых», поиск по названию,
 * имени клиента и его почте.
 */
export function selectProjects(
  items: ProjectManagerView[],
  f: ProjectFilters,
): ProjectManagerView[] {
  const q = f.q.trim().toLowerCase();
  const out = items.filter((p) => {
    if (f.status === 'unfinished') {
      if (!UNFINISHED.includes(p.status)) return false;
    } else if (f.status) {
      if (p.status !== f.status) return false;
    } else if (p.status === 'cancelled') {
      return false;
    }
    if (!f.includeTest && p.is_test) return false;
    if (f.kind && p.kind !== f.kind) return false;
    if (f.manager === 'none') {
      if (p.assigned_to_user_id) return false;
    } else if (f.manager && p.assigned_to_user_id !== f.manager) {
      return false;
    }
    if (q.length >= MIN_QUERY && !matchesQuery(p, q)) return false;
    return true;
  });
  return sortProjects(out, f.sort);
}

// Клиент у проекта бывает двух видов: зарегистрированный (имя в профиле,
// запасной вариант — почта) и без аккаунта (имя прямо на проекте). Ищем
// по всем — иначе половина проектов по имени клиента не находится.
function matchesQuery(p: ProjectManagerView, q: string): boolean {
  const haystack = [p.title, p.client_display_name, p.client?.display_name, p.client?.email];
  return haystack.some((v) => !!v && v.toLowerCase().includes(q));
}

function sortProjects(items: ProjectManagerView[], sort: AdminProjectsSort): ProjectManagerView[] {
  const field = sort.startsWith('created') ? 'created_at' : 'updated_at';
  const asc = sort.endsWith('_asc');
  return [...items].sort((a, b) => {
    const cmp = (a[field] ?? '').localeCompare(b[field] ?? '');
    // Второй ключ — название: строки с одинаковой датой иначе скачут
    // между перерисовками, и список выглядит живущим своей жизнью.
    return (asc ? cmp : -cmp) || a.title.localeCompare(b.title);
  });
}
