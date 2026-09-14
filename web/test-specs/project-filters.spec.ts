import {
  DEFAULT_PROJECT_FILTERS,
  ProjectFilters,
  parseProjectFilters,
  projectFiltersToParams,
  projectFiltersToQuery,
} from '@entities/project/lib/project-filters';

/**
 * Фильтры списка проектов живут в адресе.
 *
 * Проверяем ровно то, ради чего они туда переехали: ссылку на выборку
 * можно переслать, и она откроется той же выборкой. Значит, из адреса
 * читается то же, что в него записали, а на сервер уходят те же
 * параметры, что уходили бы при ручном наборе фильтров.
 */

/** Заглушка ParamMap: фильтрам от него нужен один метод. */
function params(q: Record<string, string>) {
  return { get: (n: string) => (n in q ? q[n] : null) };
}

describe('parseProjectFilters', () => {
  it('пустой адрес — значения по умолчанию', () => {
    expect(parseProjectFilters(params({}))).toEqual(DEFAULT_PROJECT_FILTERS);
  });

  it('читает поиск, статус, ветку, менеджера, сортировку и тестовые', () => {
    const f = parseProjectFilters(
      params({
        q: ' ромашка ',
        status: 'on_hold',
        kind: 'creators_turnkey',
        manager: 'none',
        sort: 'created_desc',
        test: '1',
      }),
    );
    expect(f.q).toBe('ромашка');
    expect(f.status).toBe('on_hold');
    expect(f.kind).toBe('creators_turnkey');
    expect(f.manager).toBe('none');
    expect(f.sort).toBe('created_desc');
    expect(f.includeTest).toBeTrue();
  });

  // Цифра у раздела в сайдбаре считает незавершённые проекты. Если список
  // по умолчанию покажет другой набор, число и строки разойдутся — и это
  // читается как поломка, а не как фильтр.
  it('по умолчанию — активные, то есть незавершённые', () => {
    expect(parseProjectFilters(params({})).status).toBe('unfinished');
    expect(projectFiltersToParams(parseProjectFilters(params({}))).status).toBe('unfinished');
  });

  it('«Все статусы» пишутся в адрес словом: пустое значение из него исчезает', () => {
    expect(parseProjectFilters(params({ status: 'all' })).status).toBe('');
    expect(
      projectFiltersToParams(parseProjectFilters(params({ status: 'all' }))).status,
    ).toBeUndefined();
  });

  it('вид канбана — из ?view, всё остальное читается как список', () => {
    expect(parseProjectFilters(params({ view: 'board' })).view).toBe('board');
    expect(parseProjectFilters(params({ view: 'kanban' })).view).toBe('list');
    expect(parseProjectFilters(params({})).view).toBe('list');
  });

  // Адрес приходит снаружи — из письма, закладки, чужой переписки. Мусор
  // в нём не должен доезжать до запроса как есть: на незнакомый статус
  // ручка отвечает 500, и опечатка в чужой ссылке роняла бы экран.
  it('чужие значения статуса, ветки и сортировки не доезжают до запроса', () => {
    const f = parseProjectFilters(params({ status: 'drop table', kind: 'что-то', sort: 'random' }));
    expect(f.status).toBe(DEFAULT_PROJECT_FILTERS.status);
    expect(f.kind).toBe('');
    expect(f.sort).toBe(DEFAULT_PROJECT_FILTERS.sort);
    const sent = projectFiltersToParams(f);
    expect(sent.status).toBe('unfinished');
    expect(sent.kind).toBeUndefined();
  });

  it('размер страницы — только из списка допустимых', () => {
    expect(parseProjectFilters(params({ size: '50' })).pageSize).toBe(50);
    // Иначе `?size=100000` из письма означал бы «выгрузи всё» одной ссылкой.
    expect(parseProjectFilters(params({ size: '100000' })).pageSize).toBe(20);
    expect(parseProjectFilters(params({ size: '0' })).pageSize).toBe(20);
  });

  it('номер страницы меньше единицы или нечисло — первая страница', () => {
    expect(parseProjectFilters(params({ page: '3' })).page).toBe(3);
    expect(parseProjectFilters(params({ page: '0' })).page).toBe(1);
    expect(parseProjectFilters(params({ page: 'нет' })).page).toBe(1);
  });
});

describe('projectFiltersToQuery', () => {
  it('значения по умолчанию в адрес не пишутся', () => {
    const q = projectFiltersToQuery(DEFAULT_PROJECT_FILTERS);
    for (const [key, value] of Object.entries(q)) {
      expect(value).withContext(`${key} не должен попадать в адрес`).toBeNull();
    }
  });

  it('что записали в адрес, то из него и читается', () => {
    const f: ProjectFilters = {
      q: 'ромашка',
      status: 'active',
      kind: 'production_turnkey',
      manager: 'none',
      sort: 'created_asc',
      includeTest: true,
      view: 'board',
      page: 3,
      pageSize: 50,
    };
    const q = projectFiltersToQuery(f);
    const flat: Record<string, string> = {};
    for (const [k, v] of Object.entries(q)) if (v !== null) flat[k] = v;
    expect(parseProjectFilters(params(flat))).toEqual(f);
  });
});

describe('projectFiltersToParams', () => {
  it('страница считается в limit/offset — бэк номера страниц не знает', () => {
    const p = projectFiltersToParams({ ...DEFAULT_PROJECT_FILTERS, page: 3, pageSize: 50 });
    expect(p.limit).toBe(50);
    expect(p.offset).toBe(100);
  });

  it('однобуквенный поиск не шлём — сервер его всё равно игнорирует', () => {
    expect(projectFiltersToParams({ ...DEFAULT_PROJECT_FILTERS, q: 'р' }).q).toBeUndefined();
    expect(projectFiltersToParams({ ...DEFAULT_PROJECT_FILTERS, q: 'ро' }).q).toBe('ро');
  });

  it('пустые фильтры в запрос не попадают вовсе', () => {
    const p = projectFiltersToParams({ ...DEFAULT_PROJECT_FILTERS, status: '' });
    expect(p.status).toBeUndefined();
    expect(p.kind).toBeUndefined();
    expect(p.manager).toBeUndefined();
    // include_test не шлём: сервер по умолчанию и так прячет тестовые.
    expect(p.include_test).toBeUndefined();
  });
});
