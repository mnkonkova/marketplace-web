import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { NzMessageService } from 'ng-zorro-antd/message';
import { EMPTY, of } from 'rxjs';

import { ClientProfileApi } from '@entities/me/api/client-profile.api';
import { OrderApi } from '@entities/order/api/order.api';
import { ProjectApi } from '@entities/project/api/project.api';
import { ProjectDetailPage } from '@pages/me/project-detail/project-detail.page';
import { ProjectsListPage } from '@pages/me/projects-list/projects-list.page';

/**
 * Футер в кабинете заказчика.
 *
 * Его там не было вовсе, и владелец продукта сказала прямо: «нет футера —
 * неудобно». Обе страницы кабинета длинные — список проектов со сводкой,
 * карточка проекта с лентой роликов, календарём, составом и счётом, — и
 * со дна такой страницы уйти было некуда, кроме как прокрутить обратно
 * наверх. Поддержка, оферта и политика лежали только на публичных
 * страницах, то есть ровно там, куда залогиненный человек не ходит.
 *
 * Футер ТОТ ЖЕ, что на публичных страницах, а не свой: в нём телефон
 * поддержки, оферта и политика, и второй экземпляр значил бы, что однажды
 * их поправят в одном месте из двух. Поэтому тест смотрит на конкретный
 * элемент <app-support-footer>, а не просто на наличие какого-то <footer>:
 * «футер есть» и «футер общий» — разные утверждения, и разойтись они могут
 * молча.
 */
describe('кабинет заказчика: футер', () => {
  function providers() {
    return [
      provideHttpClient(),
      provideHttpClientTesting(),
      provideRouter([]),
      {
        provide: ClientProfileApi,
        useValue: {
          get: () => of({ user_id: 'u1', display_name: 'PetFlat', phone: '', telegram: '' }),
        },
      },
      {
          provide: OrderApi,
          useValue: {
            listOrders: () => of({ items: [] }),
            // Условия тянутся ради объёма роликов в смете.
            terms: () => of({ terms: { videos_first_month: 30 }, consented: true }),
          },
        },
      {
        provide: NzMessageService,
        useValue: jasmine.createSpyObj('msg', ['success', 'error', 'warning']),
      },
    ];
  }

  it('в списке проектов футер есть', () => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        ...providers(),
        {
          provide: ActivatedRoute,
          useValue: { queryParamMap: of(convertToParamMap({ tab: 'projects' })) },
        },
        { provide: ProjectApi, useValue: { listClientProjects: () => of({ items: [] }) } },
      ],
    });
    const fixture = TestBed.createComponent(ProjectsListPage);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('app-support-footer'))
      .withContext('со дна списка проектов идти некуда')
      .not.toBeNull();
  });

  /**
   * Карточка проекта — самая длинная страница кабинета, и футер нужен ей
   * в первую очередь. Проект здесь не грузится (ручка молчит): футер
   * стоит СНАРУЖИ <main>, и от того, доехали данные или нет, его наличие
   * зависеть не должно — иначе на медленной сети низ страницы пустой.
   */
  it('в карточке проекта футер есть даже до загрузки данных', () => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        ...providers(),
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { paramMap: convertToParamMap({ id: 'pr1' }) } },
        },
        { provide: ProjectApi, useValue: { getClientFunnel: () => EMPTY } },
      ],
    });
    const fixture = TestBed.createComponent(ProjectDetailPage);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('app-support-footer'))
      .withContext('карточка проекта — самая длинная страница кабинета')
      .not.toBeNull();
    fixture.destroy();
  });
});
