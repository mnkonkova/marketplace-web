import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { NzMessageService } from 'ng-zorro-antd/message';

import { BillingApi } from '@entities/billing/api/billing.api';
import { PublicationApi } from '@entities/publication/api/publication.api';
import { ProjectClientView } from '@entities/project/model/project.types';
import { ClientTurnkeyProjectComponent } from '@widgets/client-turnkey-project/client-turnkey-project.component';

/**
 * Виджет проекта заказчика грузит пять ручек и делает это ровно один раз
 * на проект.
 *
 * Страница проекта опрашивает воронку раз в 30 секунд и каждый раз кладёт
 * в input НОВЫЙ объект — эффект, зависящий от объекта целиком, срабатывал
 * на каждый опрос. Это не только лишний трафик: свежий ответ clientPrefs
 * затирал галочку уведомлений, которую пользователь только что переключил
 * и чей PUT ещё летел. Юнит-тест ловит это мгновенно, а браузерный ждал бы
 * полминуты.
 */
describe('ClientTurnkeyProjectComponent: загрузка данных', () => {
  let pubApi: jasmine.SpyObj<PublicationApi>;
  let billingApi: jasmine.SpyObj<BillingApi>;

  function project(over: Partial<ProjectClientView> = {}): ProjectClientView {
    return {
      id: 'pr1',
      kind: 'creators_turnkey',
      title: 'PetFlat · UGC',
      progress: 40,
      ...over,
    } as ProjectClientView;
  }

  function setup() {
    TestBed.resetTestingModule();
    pubApi = jasmine.createSpyObj<PublicationApi>('pubApi', [
      'clientVideos',
      'clientReport',
      'clientPrefs',
      'clientCalendar',
    ]);
    pubApi.clientVideos.and.returnValue(of({ items: [] }));
    // Содержимое ответов тесту безразлично: он считает вызовы, а не
    // разбирает данные.
    pubApi.clientReport.and.returnValue(of({} as never) as never);
    pubApi.clientPrefs.and.returnValue(of({} as never) as never);
    pubApi.clientCalendar.and.returnValue(of({ days: [] } as never) as never);
    billingApi = jasmine.createSpyObj<BillingApi>('billingApi', ['clientBilling']);
    billingApi.clientBilling.and.returnValue(of({} as never) as never);

    TestBed.configureTestingModule({
      providers: [
        { provide: PublicationApi, useValue: pubApi },
        { provide: BillingApi, useValue: billingApi },
        { provide: NzMessageService, useValue: jasmine.createSpyObj('msg', ['error', 'success']) },
      ],
    });
    TestBed.overrideComponent(ClientTurnkeyProjectComponent, { set: { template: '' } });
    const fixture = TestBed.createComponent(ClientTurnkeyProjectComponent);
    fixture.componentRef.setInput('project', project());
    fixture.detectChanges();
    return fixture;
  }

  it('грузит каждую ручку один раз при открытии проекта', () => {
    setup();
    expect(pubApi.clientVideos).toHaveBeenCalledTimes(1);
    expect(pubApi.clientReport).toHaveBeenCalledTimes(1);
    expect(pubApi.clientPrefs).toHaveBeenCalledTimes(1);
    expect(pubApi.clientCalendar).toHaveBeenCalledTimes(1);
    expect(billingApi.clientBilling).toHaveBeenCalledTimes(1);
  });

  it('опрос страницы не перезапрашивает данные: тот же проект — новый объект', () => {
    const fixture = setup();
    // Ровно то, что делает поллинг: свежий объект с тем же id.
    fixture.componentRef.setInput('project', project({ progress: 55 }));
    fixture.detectChanges();
    fixture.componentRef.setInput('project', project({ progress: 60 }));
    fixture.detectChanges();

    expect(pubApi.clientVideos).toHaveBeenCalledTimes(1);
    expect(pubApi.clientPrefs.calls.count())
      .withContext('перезапрос настроек затирал бы только что переключённую галочку')
      .toBe(1);
  });

  it('смена проекта данные перечитывает', () => {
    const fixture = setup();
    fixture.componentRef.setInput('project', project({ id: 'pr2' }));
    fixture.detectChanges();
    expect(pubApi.clientVideos).toHaveBeenCalledTimes(2);
    expect(pubApi.clientVideos).toHaveBeenCalledWith('pr2');
  });

  it('листание календаря дёргает только календарь', () => {
    const fixture = setup();
    const cmp = fixture.componentInstance;

    cmp.onMonthChange('2026-10');
    fixture.detectChanges();

    expect(pubApi.clientCalendar).toHaveBeenCalledTimes(2);
    expect(pubApi.clientCalendar).toHaveBeenCalledWith('pr1', '2026-10');
    // Месяц читается внутри load(): без untracked он попадал в
    // зависимости эффекта, и листание перезапускало всю загрузку.
    expect(pubApi.clientVideos).toHaveBeenCalledTimes(1);
    expect(billingApi.clientBilling).toHaveBeenCalledTimes(1);
  });
});

/**
 * Ссылки на сами ролики.
 *
 * Главное доказательство на этом экране — не число, а то, что его можно
 * открыть и сверить на площадке. Раньше ссылка лежала под раскрытием «По
 * площадкам» вместе с разбором чисел, то есть в двух кликах от главного.
 */
describe('ClientTurnkeyProjectComponent: ссылки на ролики', () => {
  function setup(rows: { publication_id: string; platform: string; url: string }[]) {
    TestBed.resetTestingModule();
    const pubApi = jasmine.createSpyObj<PublicationApi>('pubApi', [
      'clientVideos',
      'clientReport',
      'clientPrefs',
      'clientCalendar',
    ]);
    pubApi.clientVideos.and.returnValue(of({ items: [] }));
    pubApi.clientReport.and.returnValue(of({ videos_table: rows } as never) as never);
    pubApi.clientPrefs.and.returnValue(of({} as never) as never);
    pubApi.clientCalendar.and.returnValue(of({ days: [] } as never) as never);
    const billingApi = jasmine.createSpyObj<BillingApi>('billingApi', ['clientBilling']);
    billingApi.clientBilling.and.returnValue(of({} as never) as never);

    TestBed.configureTestingModule({
      providers: [
        { provide: PublicationApi, useValue: pubApi },
        { provide: BillingApi, useValue: billingApi },
        { provide: NzMessageService, useValue: jasmine.createSpyObj('msg', ['error', 'success']) },
      ],
    });
    TestBed.overrideComponent(ClientTurnkeyProjectComponent, { set: { template: '' } });
    const fixture = TestBed.createComponent(ClientTurnkeyProjectComponent);
    fixture.componentRef.setInput('project', {
      id: 'pr1',
      kind: 'creators_turnkey',
      title: 'PetFlat · UGC',
      progress: 40,
    } as ProjectClientView);
    fixture.detectChanges();
    return fixture.componentInstance;
  }

  const video = { publication_id: 'p1', platforms: ['tiktok', 'vk'] } as never;

  it('у каждой площадки ролика — ссылка на этот ролик', () => {
    const cmp = setup([
      { publication_id: 'p1', platform: 'tiktok', url: 'https://tiktok.com/v1' },
      { publication_id: 'p1', platform: 'vk', url: 'https://vk.com/v1' },
      // Чужой ролик: его ссылка сюда попасть не должна.
      { publication_id: 'p2', platform: 'tiktok', url: 'https://tiktok.com/other' },
    ]);
    expect(cmp.linksOf(video)).toEqual([
      { platform: 'tiktok', url: 'https://tiktok.com/v1' },
      { platform: 'vk', url: 'https://vk.com/v1' },
    ]);
  });

  /**
   * Площадка отмечена, а URL ещё не сдан. Значок остаётся значком:
   * мёртвая ссылка хуже её отсутствия — по ней идут и возвращаются ни с
   * чем, и доверие к остальным ссылкам падает вместе с ней.
   */
  it('без ссылки площадка остаётся значком, а не мёртвой ссылкой', () => {
    const cmp = setup([{ publication_id: 'p1', platform: 'tiktok', url: 'https://tiktok.com/v1' }]);
    expect(cmp.linksOf(video)).toEqual([
      { platform: 'tiktok', url: 'https://tiktok.com/v1' },
      { platform: 'vk', url: '' },
    ]);
  });
});
