import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { NzMessageService } from 'ng-zorro-antd/message';
import { NzModalService } from 'ng-zorro-antd/modal';
import { of } from 'rxjs';

import { AdminApi } from '@entities/admin/api/admin.api';
import { ProjectManagerView } from '@entities/project/model/project.types';
import { AdminProjectsListPage } from '@pages/admin/projects/projects-list.page';

/**
 * Админский список проектов.
 *
 * Проверяем ровно одно: поиск, фильтры, сортировка и страница уезжают на
 * сервер параметрами запроса. Пока список фильтровался в браузере, ручку
 * дёргали один раз и без параметров, а всё остальное делали над уже
 * загруженным массивом — с ростом числа проектов это тупик.
 */

function page(): { page: AdminProjectsListPage; http: HttpTestingController } {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      {
        provide: Router,
        useValue: jasmine.createSpyObj<Router>('Router', ['navigate'], { url: '/admin/projects' }),
      },
      {
        provide: NzModalService,
        useValue: jasmine.createSpyObj<NzModalService>('modal', ['create']),
      },
      {
        provide: NzMessageService,
        useValue: jasmine.createSpyObj<NzMessageService>('msg', ['success', 'error']),
      },
      {
        provide: AdminApi,
        useValue: { listManagers: () => of({ items: [] }) },
      },
    ],
  });
  // Шаблон отключаем: внутри него админский layout со ссылками, и тест
  // тащил бы за собой роутер целиком. Проверяем то, ради чего спека и
  // написана, — какой запрос уходит на сервер.
  TestBed.overrideComponent(AdminProjectsListPage, { set: { template: '' } });
  const fixture = TestBed.createComponent(AdminProjectsListPage);
  fixture.detectChanges();
  return { page: fixture.componentInstance, http: TestBed.inject(HttpTestingController) };
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

  it('поиск уходит на сервер параметром q, а не фильтрует загруженное', (done) => {
    const { page: p, http } = page();
    lastListRequest(http);

    p.q = 'ромашка';
    p.onSearch();
    // debounce 300мс — ждём чуть дольше, иначе проверяем пустоту.
    setTimeout(() => {
      const req = lastListRequest(http);
      expect(req.request.params.get('q')).toBe('ромашка');
      http.verify();
      done();
    }, 400);
  });

  it('однобуквенный запрос не шлём — сервер его всё равно игнорирует', (done) => {
    const { page: p, http } = page();
    lastListRequest(http);

    p.q = 'р';
    p.onSearch();
    setTimeout(() => {
      const req = lastListRequest(http);
      expect(req.request.params.get('q')).toBeNull();
      http.verify();
      done();
    }, 400);
  });

  it('фильтры менеджера, статуса и тестовых уезжают в запрос', () => {
    const { page: p, http } = page();
    lastListRequest(http);

    p.status = 'on_hold';
    p.manager = 'none';
    p.includeTest = true;
    p.onFilterChange();

    const req = lastListRequest(http);
    expect(req.request.params.get('status')).toBe('on_hold');
    expect(req.request.params.get('manager')).toBe('none');
    expect(req.request.params.get('include_test')).toBe('true');
    http.verify();
  });

  it('смена фильтра возвращает на первую страницу', () => {
    const { page: p, http } = page();
    lastListRequest(http, 100);

    p.onQueryParamsChange({ pageIndex: 3, pageSize: 20 } as never);
    let req = lastListRequest(http, 100);
    expect(req.request.params.get('offset')).toBe('40');

    p.status = 'active';
    p.onFilterChange();
    req = lastListRequest(http, 100);
    // Остаться на третьей странице сузившегося набора значит увидеть
    // пустую таблицу вместо результата фильтра.
    expect(req.request.params.get('offset')).toBe('0');
    http.verify();
  });

  it('страница листается limit/offset, а не срезом массива в браузере', () => {
    const { page: p, http } = page();
    lastListRequest(http, 250);

    p.onQueryParamsChange({ pageIndex: 2, pageSize: 50 } as never);
    const req = lastListRequest(http, 250);
    expect(req.request.params.get('limit')).toBe('50');
    expect(req.request.params.get('offset')).toBe('50');
    // total приходит с сервера: без него пагинатор не знает, сколько
    // страниц, и по длине items насчитал бы одну.
    expect(p.total()).toBe(250);
    http.verify();
  });
});
