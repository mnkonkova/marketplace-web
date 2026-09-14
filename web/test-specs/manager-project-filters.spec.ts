import {
  DEFAULT_PROJECT_FILTERS,
  MANAGER_STATUS_OPTIONS,
  ProjectFilters,
  STATUS_OPTIONS,
  parseProjectFilters,
  selectProjects,
} from '@entities/project/lib/project-filters';
import type { ProjectManagerView } from '@entities/project/model/project.types';

/**
 * Отбор проектов на странице менеджера.
 *
 * Фильтры у менеджера те же, что у админа, и разбираются тем же кодом,
 * но применяются на месте: `GET /manager/projects` параметров не
 * принимает. Проверяем ровно то, ради чего функция общая — что «Активные»
 * у менеджера значат то же, что у админа, и что правила совпадают с
 * серверными (`Repo.ListAll` в marketplace-api): незавершённые четвёркой,
 * пустой статус — всё, кроме отменённых, поиск по названию, имени клиента
 * и его почте, тестовые скрыты, пока не попросили.
 */

function project(over: Partial<ProjectManagerView> = {}): ProjectManagerView {
  return {
    id: over.id ?? 'p1',
    client_user_id: 'c1',
    kind: 'creators_turnkey',
    is_test: false,
    title: 'Проект',
    source: 'manual',
    status: 'active',
    revisions_included: 0,
    revisions_used: 0,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    display_status: 'in_progress',
    progress: 0,
    current_stage_order: 0,
    ...over,
  };
}

function filters(over: Partial<ProjectFilters> = {}): ProjectFilters {
  return { ...DEFAULT_PROJECT_FILTERS, ...over };
}

function titles(items: ProjectManagerView[]): string[] {
  return items.map((p) => p.title);
}

describe('selectProjects: статус', () => {
  const all = [
    project({ id: '1', title: 'черновик', status: 'draft' }),
    project({ id: '2', title: 'в работе', status: 'active' }),
    project({ id: '3', title: 'на паузе', status: 'on_hold' }),
    project({ id: '4', title: 'спор', status: 'dispute' }),
    project({ id: '5', title: 'завершён', status: 'done' }),
    project({ id: '6', title: 'отменён', status: 'cancelled' }),
  ];

  it('«Активные» — ровно четыре незавершённых статуса', () => {
    const got = titles(selectProjects(all, filters({ status: 'unfinished' })));
    expect(got.sort()).toEqual(['в работе', 'на паузе', 'спор', 'черновик']);
  });

  it('«Все статусы» — всё, кроме отменённых', () => {
    const got = titles(selectProjects(all, filters({ status: '' })));
    expect(got).not.toContain('отменён');
    expect(got).toContain('завершён');
    expect(got.length).toBe(5);
  });

  it('точный статус отбирает только его', () => {
    expect(titles(selectProjects(all, filters({ status: 'on_hold' })))).toEqual(['на паузе']);
  });

  it('отменённые видно, только если их спросили явно', () => {
    expect(titles(selectProjects(all, filters({ status: 'cancelled' })))).toEqual(['отменён']);
  });
});

describe('selectProjects: ветка, тестовые и ответственный', () => {
  it('ветка отбирается точным совпадением', () => {
    const all = [
      project({ id: '1', title: 'креаторы', kind: 'creators_turnkey' }),
      project({ id: '2', title: 'продакшн', kind: 'production_turnkey' }),
    ];
    expect(titles(selectProjects(all, filters({ kind: 'production_turnkey' })))).toEqual([
      'продакшн',
    ]);
  });

  it('тестовые скрыты по умолчанию и показываются по просьбе', () => {
    const all = [
      project({ id: '1', title: 'настоящий' }),
      project({ id: '2', title: 'тест', is_test: true }),
    ];
    expect(titles(selectProjects(all, filters()))).toEqual(['настоящий']);
    expect(titles(selectProjects(all, filters({ includeTest: true }))).sort()).toEqual([
      'настоящий',
      'тест',
    ]);
  });

  it('«Без ответственного» — это не «любой менеджер»', () => {
    const all = [
      project({ id: '1', title: 'ничей' }),
      project({ id: '2', title: 'чужой', assigned_to_user_id: 'm-2' }),
    ];
    expect(titles(selectProjects(all, filters({ manager: 'none' })))).toEqual(['ничей']);
    expect(titles(selectProjects(all, filters({ manager: 'm-2' })))).toEqual(['чужой']);
  });
});

describe('selectProjects: поиск', () => {
  const all = [
    project({ id: '1', title: 'Ромашка · UGC' }),
    project({ id: '2', title: 'Лютик', client_display_name: 'ООО Ромашка' }),
    project({ id: '3', title: 'Василёк', client: { email: 'romashka@example.com' } }),
    project({ id: '4', title: 'Одуванчик' }),
  ];

  it('ищет по названию, имени клиента и его почте', () => {
    expect(titles(selectProjects(all, filters({ q: 'ромашка' }))).sort()).toEqual([
      'Лютик',
      'Ромашка · UGC',
    ]);
    expect(titles(selectProjects(all, filters({ q: 'romashka' })))).toEqual(['Василёк']);
  });

  it('регистр не важен', () => {
    expect(titles(selectProjects(all, filters({ q: 'РОМАШКА' }))).length).toBe(2);
  });

  // Сервер короче двух символов поиск игнорирует. Если бы здесь было
  // иначе, один и тот же адрес давал бы у админа и у менеджера разные
  // списки — и объяснить это было бы нечем.
  it('однобуквенный запрос игнорируется, как и на сервере', () => {
    expect(selectProjects(all, filters({ q: 'р' })).length).toBe(all.length);
  });
});

describe('selectProjects: порядок', () => {
  const all = [
    project({ id: '1', title: 'старый', updated_at: '2026-01-01T00:00:00Z' }),
    project({ id: '2', title: 'свежий', updated_at: '2026-03-01T00:00:00Z' }),
    project({ id: '3', title: 'средний', updated_at: '2026-02-01T00:00:00Z' }),
  ];

  it('«давно не двигались» — самые давние сверху', () => {
    expect(titles(selectProjects(all, filters({ sort: 'updated_asc' })))).toEqual([
      'старый',
      'средний',
      'свежий',
    ]);
  });

  it('«недавно обновлённые» — наоборот', () => {
    expect(titles(selectProjects(all, filters({ sort: 'updated_desc' })))).toEqual([
      'свежий',
      'средний',
      'старый',
    ]);
  });

  it('сортирует по created_at, когда просят порядок создания', () => {
    const byCreated = [
      project({ id: '1', title: 'первый', created_at: '2026-01-01T00:00:00Z' }),
      project({ id: '2', title: 'второй', created_at: '2026-02-01T00:00:00Z' }),
    ];
    expect(titles(selectProjects(byCreated, filters({ sort: 'created_desc' })))).toEqual([
      'второй',
      'первый',
    ]);
  });

  it('исходный массив не переписывается', () => {
    const src = [...all];
    selectProjects(src, filters({ sort: 'updated_desc' }));
    expect(titles(src)).toEqual(['старый', 'свежий', 'средний']);
  });
});

describe('фильтры менеджера читаются из адреса тем же кодом', () => {
  it('адрес с фильтрами разбирается в те же значения', () => {
    const f = parseProjectFilters({
      get: (n: string) =>
        ({ q: 'ромашка', status: 'on_hold', kind: 'creators_turnkey', sort: 'created_desc' })[n] ??
        null,
    });
    expect(f.q).toBe('ромашка');
    expect(f.status).toBe('on_hold');
    expect(f.kind).toBe('creators_turnkey');
    expect(f.sort).toBe('created_desc');
  });

  /**
   * Менеджерской ручке нечего отдать по завершённым и отменённым: она
   * отбирает только незавершённые. Выпадашка, у которой половина значений
   * всегда даёт пустой список, читается как поломка — поэтому набор
   * менеджера короче, но собирается из общего, а не набирается заново.
   */
  it('менеджеру не предлагают статусы, которых в его списке не бывает', () => {
    const values = MANAGER_STATUS_OPTIONS.map((o) => o.value);
    expect(values).not.toContain('done');
    expect(values).not.toContain('cancelled');
    expect(values).toContain('unfinished');
    // Подписи — те же самые, а не похожие: набор один на две страницы.
    for (const o of MANAGER_STATUS_OPTIONS) {
      expect(STATUS_OPTIONS).toContain(o);
    }
  });
});
