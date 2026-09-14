import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Params, Router, convertToParamMap } from '@angular/router';
import { NzModalService } from 'ng-zorro-antd/modal';
import { BehaviorSubject, map, of } from 'rxjs';

import { AdminApi } from '@entities/admin/api/admin.api';
import { ProjectManagerView } from '@entities/project/model/project.types';
import { AdminProjectsListPage } from '@pages/admin/projects/projects-list.page';

/**
 * Админский список проектов.
 *
 * Проверяем две вещи. Первая осталась прежней: поиск, фильтры, сортировка
 * и страница уезжают на сервер параметрами запроса — фильтрация серверная,
 * и клиентской она быть не может, проектов больше, чем страница.
 *
 * Вторая новая: единственный источник этих параметров — адрес. Пока
 * фильтры лежали полями компонента, ссылку на выборку переслать было
 * нечем, а F5 возвращал на чистый список. Поэтому здесь меняется адрес, а
 * ожидается запрос.
 */

/** Адрес страницы под нашим управлением: меняем query — компонент реагирует. */
function routeStub(initial: Params) {
  const q$ = new BehaviorSubject<Params>(initial);
  return {
    q$,
    route: {
      snapshot: { queryParamMap: convertToParamMap(initial) },
      queryParamMap: q$.pipe(map((p) => convertToParamMap(p))),
    } as unknown as ActivatedRoute,
  };
}

function page(initial: Params = {}): {
  page: AdminProjectsListPage;
  http: HttpTestingController;
  go: (q: Params) => void;
  detect: () => void;
} {
  TestBed.resetTestingModule();
  const { q$, route } = routeStub(initial);
  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      { provide: ActivatedRoute, useValue: route },
      {
        provide: Router,
        useValue: jasmine.createSpyObj<Router>('Router', ['navigate'], { url: '/admin/projects' }),
      },
      {
        provide: NzModalService,
        useValue: jasmine.createSpyObj<NzModalService>('modal', ['create']),
      },
      { provide: AdminApi, useValue: { listManagers: () => of({ items: [] }) } },
    ],
  });
  // Шаблон отключаем: внутри него канбан и таблица со ссылками, и тест
  // тащил бы за собой роутер целиком. Проверяем то, ради чего спека и
  // написана, — какой запрос уходит на сервер.
  TestBed.overrideComponent(AdminProjectsListPage, { set: { template: '' } });
  const fixture = TestBed.createComponent(AdminProjectsListPage);
  fixture.detectChanges();
  return {
    page: fixture.componentInstance,
    http: TestBed.inject(HttpTestingController),
    go: (q: Params) => {
      q$.next(q);
      fixture.detectChanges();
    },
    detect: () => fixture.detectChanges(),
  };
}

// Забирает последний запрос к /admin/projects и отвечает на него.
function lastListRequest(http: HttpTestingController, total = 0, items: ProjectManagerView[] = []) {
  const reqs = http.match((r) => r.url.endsWith('/admin/projects'));
  expect(reqs.length).toBeGreaterThan(0);
  const req = reqs[reqs.length - 1];
  req.flush({ items, total, limit: 20, offset: 0 });
  return req;
}

describe('AdminProjectsListPage', () => {
  it('первый запрос просит давно не двигавшиеся и прячет тестовые', () => {
    const { http } = page();
    const req = lastListRequest(http);
    // Ради этого сортировка и заведена: список открывают с вопросом
    // «что стоит», а не «что трогали только что».
    expect(req.request.params.get('sort')).toBe('updated_asc');
    expect(req.request.params.get('limit')).toBe('20');
    expect(req.request.params.get('offset')).toBe('0');
    // include_test не шлём вовсе: сервер по умолчанию и так прячет.
    expect(req.request.params.get('include_test')).toBeNull();
    http.verify();
  });

  it('открытая по ссылке выборка уходит на сервер уже отфильтрованной', () => {
    const { http } = page({ q: 'ромашка', status: 'on_hold', manager: 'none', test: '1' });
    const req = lastListRequest(http);
    expect(req.request.params.get('q')).toBe('ромашка');
    expect(req.request.params.get('status')).toBe('on_hold');
    expect(req.request.params.get('manager')).toBe('none');
    expect(req.request.params.get('include_test')).toBe('true');
    http.verify();
  });

  it('смена адреса перечитывает список — это же покрывает «назад» в браузере', () => {
    const { http, go } = page();
    lastListRequest(http);

    go({ status: 'active' });
    const req = lastListRequest(http);
    expect(req.request.params.get('status')).toBe('active');
    http.verify();
  });

  it('страница листается limit/offset, а не срезом массива в браузере', () => {
    const { page: p, http, go } = page();
    lastListRequest(http, 250);

    go({ page: '2', size: '50' });
    const req = lastListRequest(http, 250);
    expect(req.request.params.get('limit')).toBe('50');
    expect(req.request.params.get('offset')).toBe('50');
    // total приходит с сервера: без него пагинатор не знает, сколько
    // страниц, и по длине items насчитал бы одну.
    expect(p.total()).toBe(250);
    http.verify();
  });

  it('однобуквенный запрос не шлём — сервер его всё равно игнорирует', () => {
    const { http } = page({ q: 'р' });
    const req = lastListRequest(http);
    expect(req.request.params.get('q')).toBeNull();
    http.verify();
  });

  it('поиск уезжает в адрес, а не фильтрует загруженное', (done) => {
    const { page: p, http } = page();
    lastListRequest(http);
    const router = TestBed.inject(Router) as jasmine.SpyObj<Router>;

    p.q = 'ромашка';
    p.onSearch();
    // debounce 300мс — ждём чуть дольше, иначе проверяем пустоту.
    setTimeout(() => {
      const extras = router.navigate.calls.mostRecent().args[1];
      expect(extras?.queryParams?.['q']).toBe('ромашка');
      // Смена фильтра возвращает на первую страницу: остаться на пятой при
      // сузившемся наборе значит увидеть пустую таблицу вместо результата.
      expect(extras?.queryParams?.['page']).toBeNull();
      http.verify();
      done();
    }, 400);
  });

  it('канбан за списком не ходит — он просит свой набор сам', () => {
    const { http } = page({ view: 'board' });
    expect(http.match((r) => r.url.endsWith('/admin/projects')).length).toBe(0);
    http.verify();
  });

  it('упавшая ручка — это ошибка с «Повторить», а не пустой список', () => {
    const { page: p, http } = page();
    const reqs = http.match((r) => r.url.endsWith('/admin/projects'));
    reqs[reqs.length - 1].flush(
      { error: 'boom', message: 'Всё сломалось' },
      { status: 500, statusText: 'err' },
    );
    expect(p.error()).toBe('Всё сломалось');
    expect(p.items()).toEqual([]);
    http.verify();
  });
});
