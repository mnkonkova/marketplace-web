import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { NzMessageService } from 'ng-zorro-antd/message';
import { of } from 'rxjs';

import { ClientProfileApi } from '@entities/me/api/client-profile.api';
import { OrderApi } from '@entities/order/api/order.api';
import { ProjectApi } from '@entities/project/api/project.api';
import type { ProjectClientView } from '@entities/project/model/project.types';
import { ProjectsListPage } from '@pages/me/projects-list/projects-list.page';

/**
 * Кабинет заказчика: первый экран.
 *
 * Владелец продукта сказала про него «мне не нравятся плашки», и три из
 * них были про одно и то же — про то, ЧТО стоит первым.
 *
 *  • «Проект под ключ» занимал первый экран и держал единственный коралл
 *    страницы. Коралл значит «действие», а человек, который уже платит за
 *    проект, приходит сюда за результатом: предложение завести второй
 *    читается после результата, а не вместо него.
 *  • Заголовок «Мои проекты» называл место, в которое человек уже пришёл.
 *    Этот экран показывают начальству и вставляют в коммерческое
 *    предложение — первая строка обязана отвечать на вопрос, с которым
 *    его открыли.
 *  • Проценты воронки и бейдж «Впереди» в строках проектов меряли шаги
 *    согласования, которых у проекта с креаторами нет вовсе: «100 %»
 *    стояло у проекта без единого вышедшего ролика.
 */
describe('ProjectsListPage: первый экран кабинета', () => {
  function project(over: Partial<ProjectClientView> = {}): ProjectClientView {
    return {
      id: 'p1',
      kind: 'creators_turnkey',
      title: 'PetFlat · UGC',
      progress: 100,
      display_status: 'not_started',
      created_at: '2026-09-16T00:00:00Z',
      ...over,
    } as ProjectClientView;
  }

  function setup(tab?: string, projects: ProjectClientView[] = [project()]) {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        {
          provide: ActivatedRoute,
          useValue: { queryParamMap: of(convertToParamMap(tab ? { tab } : {})) },
        },
        { provide: Router, useValue: jasmine.createSpyObj<Router>('Router', ['navigate']) },
        { provide: ProjectApi, useValue: { listClientProjects: () => of({ items: projects }) } },
        {
          provide: ClientProfileApi,
          useValue: {
            get: () =>
              of({ user_id: 'u1', display_name: 'PetFlat', phone: '+7 999', telegram: '' }),
          },
        },
        { provide: OrderApi, useValue: { listOrders: () => of({ items: [] }) } },
        {
          provide: NzMessageService,
          useValue: jasmine.createSpyObj('msg', ['success', 'error']),
        },
      ],
    });
    // Шаблон не рендерим целиком: сводку рисует отдельный виджет со своим
    // запросом, и здесь нас интересуют решения самой страницы.
    TestBed.overrideComponent(ProjectsListPage, { set: { template: '' } });
    const fixture = TestBed.createComponent(ProjectsListPage);
    fixture.detectChanges();
    return fixture.componentInstance;
  }

  it('заголовок дашборда — про результат, а не про раздел', () => {
    expect(setup().headline()).toBe('Что PetFlat получил за свои деньги');
  });

  /**
   * Имени может не быть: заказчик не заполнил контакты. Фраза обязана
   * остаться осмысленной, а не превратиться в «Что  получил за свои
   * деньги» с дырой посередине.
   */
  it('имени нет — фраза не разваливается', () => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: ActivatedRoute, useValue: { queryParamMap: of(convertToParamMap({})) } },
        { provide: Router, useValue: jasmine.createSpyObj<Router>('Router', ['navigate']) },
        { provide: ProjectApi, useValue: { listClientProjects: () => of({ items: [] }) } },
        {
          provide: ClientProfileApi,
          useValue: {
            get: () => of({ user_id: 'u1', display_name: '  ', phone: '', telegram: '' }),
          },
        },
        { provide: OrderApi, useValue: { listOrders: () => of({ items: [] }) } },
        { provide: NzMessageService, useValue: jasmine.createSpyObj('msg', ['success', 'error']) },
      ],
    });
    TestBed.overrideComponent(ProjectsListPage, { set: { template: '' } });
    const f = TestBed.createComponent(ProjectsListPage);
    f.detectChanges();
    expect(f.componentInstance.headline()).toBe('Что вы получили за свои деньги');
  });

  it('во вкладке «Проекты» заголовок называет их, а не результат', () => {
    expect(setup('projects').headline()).toBe('Проекты PetFlat');
  });

  /**
   * Проекты с креаторами показывает реестр — строкой с просмотрами и
   * ценой тысячи. Карточки с процентами остаются только тем, у кого
   * проценты что-то значат: проектам по воронке со стадиями и шагами.
   */
  it('проект с креаторами не попадает в карточки с процентами воронки', () => {
    expect(setup('projects').funnelProjects().length).toBe(0);
  });

  it('проект по воронке в карточках остаётся: там проценты про шаги', () => {
    const page = setup('projects', [project({ kind: 'general' })]);
    expect(page.funnelProjects().map((p) => p.id)).toEqual(['p1']);
  });
});
