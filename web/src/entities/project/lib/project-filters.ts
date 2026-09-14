import { AdminProjectsParams } from '../api/project.api';
import { AdminProjectsSort, ProjectStatus } from '../model/project.types';

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
 */

/** '' — без фильтра. Фильтруем по status проекта, а не по display_status:
 *  второй вычисляется из шагов, и в SQL его нет. */
export type StatusFilter = '' | ProjectStatus;

/** 'none' — проекты без ответственного. Пустым это не выразить: пустое
 *  значит «любой менеджер». */
export type ManagerFilter = '' | 'none' | string;

/** Как показан список. Канбан — тот же раздел, а не соседний адрес. */
export type ProjectsView = 'list' | 'board';

export interface ProjectFilters {
  q: string;
  status: StatusFilter;
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

const PAGE_SIZES = [20, 50, 100];

/**
 * По умолчанию — самые давно обновлённые сверху. Список открывают ровно с
 * этим вопросом: что не двигалось и кто за это отвечает.
 */
export const DEFAULT_PROJECT_FILTERS: ProjectFilters = {
  q: '',
  status: '',
  manager: '',
  sort: 'updated_asc',
  // Тестовые по умолчанию скрыты: из-за них половина списка была
  // «тест т8т 1234», и настоящие проекты в нём терялись.
  includeTest: false,
  view: 'list',
  page: 1,
  pageSize: 20,
};

/** Минимум того, что нужно от ActivatedRoute.snapshot.queryParamMap. */
export interface QueryReader {
  get(name: string): string | null;
}

export function parseProjectFilters(params: QueryReader): ProjectFilters {
  const d = DEFAULT_PROJECT_FILTERS;
  const status = params.get('status') ?? '';
  const sort = params.get('sort') ?? '';
  const size = Number(params.get('size'));
  const page = Number(params.get('page'));
  return {
    q: (params.get('q') ?? '').trim(),
    status: (STATUSES as string[]).includes(status) ? (status as ProjectStatus) : d.status,
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
    status: f.status || null,
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
  if (f.status) params.status = f.status;
  if (f.manager) params.manager = f.manager;
  if (f.includeTest) params.include_test = true;
  return params;
}
