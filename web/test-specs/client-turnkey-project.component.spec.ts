import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { NzMessageService } from 'ng-zorro-antd/message';

import { BillingApi } from '@entities/billing/api/billing.api';
import type { Accrual, Payment, ProjectBilling } from '@entities/billing/model/billing.types';
import { PublicationApi } from '@entities/publication/api/publication.api';
import type { ClientVideo } from '@entities/publication/model/publication.types';
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
      // Доступы к аккаунтам бренда: блок живёт внизу страницы проекта и
      // спрашивает свою ручку при открытии.
      'clientAccounts',
    ]);
    pubApi.clientVideos.and.returnValue(of({ items: [] }));
    // Содержимое ответов тесту безразлично: он считает вызовы, а не
    // разбирает данные.
    pubApi.clientReport.and.returnValue(of({} as never) as never);
    pubApi.clientPrefs.and.returnValue(of({} as never) as never);
    pubApi.clientCalendar.and.returnValue(of({ days: [] } as never) as never);
    pubApi.clientAccounts.and.returnValue(
      of({ items: [], secrets_enabled: false } as never) as never,
    );
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
      'clientAccounts',
      'clientReport',
      'clientPrefs',
      'clientCalendar',
    ]);
    pubApi.clientVideos.and.returnValue(of({ items: [] }));
    pubApi.clientReport.and.returnValue(of({ videos_table: rows } as never) as never);
    pubApi.clientPrefs.and.returnValue(of({} as never) as never);
    pubApi.clientCalendar.and.returnValue(of({ days: [] } as never) as never);
    pubApi.clientAccounts.and.returnValue(
      of({ items: [], secrets_enabled: false } as never) as never,
    );
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

/**
 * Календарь открывается там, где выкладки есть.
 *
 * Сетка показывает один месяц и открывалась всегда на текущем. Период
 * проекта катится от первой публикации и на календарный месяц не
 * ложится: выкладки регулярно оказывались в соседнем, и заказчик видел
 * пустую сетку — то есть «календарь не показывает выкладки».
 */
describe('ClientTurnkeyProjectComponent: месяц календаря', () => {
  function setup(months: string[], days: unknown[] = []) {
    TestBed.resetTestingModule();
    const pubApi = jasmine.createSpyObj<PublicationApi>('pubApi', [
      'clientVideos',
      'clientAccounts',
      'clientReport',
      'clientPrefs',
      'clientCalendar',
    ]);
    pubApi.clientVideos.and.returnValue(of({ items: [] }));
    pubApi.clientReport.and.returnValue(of({} as never) as never);
    pubApi.clientPrefs.and.returnValue(of({} as never) as never);
    pubApi.clientCalendar.and.returnValue(of({ days, months } as never) as never);
    pubApi.clientAccounts.and.returnValue(
      of({ items: [], secrets_enabled: false } as never) as never,
    );
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
    return { fixture, pubApi };
  }

  /** Текущий месяц — тот же, с которого начинает компонент. */
  function thisMonth(): string {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  }

  /** Прошлый месяц: в нём и оказывались выкладки идущего периода. */
  function lastMonth(): string {
    const d = new Date();
    d.setDate(1);
    d.setMonth(d.getMonth() - 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  }

  it('в текущем месяце выкладок нет — календарь открывается на том, где они есть', () => {
    const { fixture, pubApi } = setup([lastMonth()]);

    expect(pubApi.clientCalendar.calls.allArgs().map((a) => a[1]))
      .withContext('первый запрос — текущий месяц, второй — тот, где выкладки')
      .toEqual([thisMonth(), lastMonth()]);
    expect(fixture.componentInstance.calendarMonth()).toBe(lastMonth());
  });

  it('в текущем месяце выкладки есть — никуда не уводим', () => {
    const { fixture, pubApi } = setup([lastMonth(), thisMonth()]);

    expect(pubApi.clientCalendar).toHaveBeenCalledTimes(1);
    expect(fixture.componentInstance.calendarMonth()).toBe(thisMonth());
  });

  it('месяцы проекта доезжают до сетки — ей по ним рисовать полосу', () => {
    const { fixture } = setup([lastMonth(), thisMonth()]);
    expect(fixture.componentInstance.calendarMonths()).toEqual([lastMonth(), thisMonth()]);
  });

  /**
   * Пустой месяц, открытый ЧЕЛОВЕКОМ, — это ответ «здесь ничего не
   * стоит», а не повод увезти его обратно. Подмена выбора читалась бы
   * как сломанные стрелки.
   */
  it('листание руками в пустой месяц не отменяется', () => {
    const { fixture, pubApi } = setup([lastMonth(), thisMonth()]);
    pubApi.clientCalendar.calls.reset();

    fixture.componentInstance.onMonthChange('2027-03');
    fixture.detectChanges();

    expect(pubApi.clientCalendar.calls.allArgs().map((a) => a[1])).toEqual(['2027-03']);
    expect(fixture.componentInstance.calendarMonth()).toBe('2027-03');
  });
});

/**
 * Счёт за прошлый период держится, пока по нему не рассчитались.
 *
 * Раньше плашка «К оплате за прошлый период» жила ровно один период:
 * начинался следующий — прошлый становился позапрошлым, и напоминание о
 * долге снимал КАЛЕНДАРЬ, а не деньги. Заплатили по нему или нет,
 * экран не знал и знать не пытался.
 *
 * Теперь снимает её отметка менеджера «Деньги пришли» по финальному
 * платежу. Отметка в базе одна на проект, а периодов много, поэтому
 * засчитывается только подтверждение не раньше конца периода — иначе
 * оплата первого периода гасила бы счета за все следующие.
 */
describe('ClientTurnkeyProjectComponent: счёт за прошлый период', () => {
  const PREV = {
    seq: 1,
    starts_on: '2026-07-31',
    ends_on: '2026-08-30',
    status: 'locked' as const,
    carry_in_client: 0,
    carry_out_client: 0,
  };

  const CURRENT = {
    seq: 2,
    starts_on: '2026-08-31',
    ends_on: '2026-09-30',
    status: 'open' as const,
    carry_in_client: 0,
    carry_out_client: 0,
  };

  function payment(over: Partial<Payment> = {}): Payment {
    return {
      id: 'pay1',
      project_id: 'pr1',
      kind: 'final',
      amount: 1_050_000,
      status: 'confirmed',
      confirmed_at: '2026-09-02T10:00:00Z',
      created_at: '2026-08-01T00:00:00Z',
      ...over,
    };
  }

  function setup(payments: Payment[], prevStatus: 'locked' | 'open' = 'locked') {
    TestBed.resetTestingModule();
    const pubApi = jasmine.createSpyObj<PublicationApi>('pubApi', [
      'clientVideos',
      'clientAccounts',
      'clientReport',
      'clientPrefs',
      'clientCalendar',
    ]);
    pubApi.clientVideos.and.returnValue(of({ items: [] }));
    pubApi.clientReport.and.returnValue(of({} as never) as never);
    pubApi.clientPrefs.and.returnValue(of({} as never) as never);
    pubApi.clientCalendar.and.returnValue(of({ days: [], months: [] } as never) as never);
    pubApi.clientAccounts.and.returnValue(
      of({ items: [], secrets_enabled: false } as never) as never,
    );

    const billingApi = jasmine.createSpyObj<BillingApi>('billingApi', ['clientBilling']);
    billingApi.clientBilling.and.callFake((_id: string, seq?: number) => {
      const billing: ProjectBilling =
        seq === 1
          ? {
              payments,
              period: { ...PREV, status: prevStatus },
              totals: { total: 1_050_000 } as never,
            }
          : { payments, period: CURRENT, totals: { total: 159_000 } as never };
      return of(billing) as never;
    });

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

  it('период подытожен, денег нет — плашка стоит', () => {
    expect(setup([]).prevDue()).withContext('счёт закрыт и не оплачен').not.toBeNull();
  });

  it('менеджер отметил «деньги пришли» — плашка уходит', () => {
    expect(setup([payment()]).prevDue()).toBeNull();
  });

  it('счёт выставлен, но не подтверждён — плашка остаётся', () => {
    // awaiting значит «сумму назвали, денег ещё нет». Снимать напоминание
    // по выставленному счёту — это снимать его до оплаты.
    expect(
      setup([payment({ status: 'awaiting', confirmed_at: undefined })]).prevDue(),
    ).not.toBeNull();
  });

  it('предоплата периода не закрывает', () => {
    // Предоплата — про старт работ, а не про закрытие периода.
    expect(setup([payment({ kind: 'prepayment' })]).prevDue()).not.toBeNull();
  });

  /**
   * Платёж в базе один на проект и вид, а периодов много. Отметка,
   * поставленная за первый период, висела бы подтверждённой вечно и
   * гасила бы счета за все следующие — то есть врала бы ровно там, где
   * речь о деньгах.
   */
  it('оплата, подтверждённая ДО конца периода, этот период не закрывает', () => {
    const early = payment({ confirmed_at: '2026-08-01T10:00:00Z' });
    expect(setup([early]).prevDue()).not.toBeNull();
  });

  it('пока прошлый период открыт, счёта нет вовсе', () => {
    // Сумма ещё меняется — выставлять её к оплате рано.
    expect(setup([], 'open').prevDue()).toBeNull();
  });
});

/**
 * Состав периода: за кого именно заказчик платит — и куда ведёт его имя.
 *
 * Буква в кружке не отвечает ни на «кто это», ни на «можно ли к нему
 * перейти». Заказчик платит за конкретных людей и про этих людей
 * спрашивает — значит, в кружке портрет, а сам кружок ведёт на страницу
 * исполнителя.
 *
 * Но ВЕДЁТ НЕ ВСЕГДА, и это второе правило здесь. Адрес складывается у
 * кого угодно — из username или из uuid, — а публичная страница живёт
 * только у опубликованного и прошедшего модерацию профиля: на всё прочее
 * ручка отдаёт 404. Ссылка стояла на всех одинаково, и по непроверенному
 * профилю состав вёл в «не найдено» — экран отвечал «такого человека
 * нет» про человека, за которого выставлен счёт.
 */
describe('ClientTurnkeyProjectComponent: команда периода', () => {
  function accrual(over: Partial<Accrual> = {}): Accrual {
    return {
      id: 'a1',
      project_id: 'pr1',
      creator_user_id: 'c1-uuid',
      creator_name: 'Анастасия Креатор',
      period_start: '2026-08-31',
      status: 'draft',
      salary: 6_000_000,
      views_base: 0,
      views_over: 0,
      views_total: 2_000_000,
      views_bonus: 9_900_000,
      clicks: 0,
      click_bonus: 0,
      videos_planned: 1,
      videos_delivered: 1,
      deduction: 0,
      total: 15_900_000,
      calculated_at: '2026-09-15T00:00:00Z',
      // По умолчанию страница человека открыта: это обычный случай, а
      // закрытый профиль проверяется отдельным тестом ниже.
      creator_profile_public: true,
      ...over,
    } as Accrual;
  }

  function setup(accruals: Accrual[], videos: ClientVideo[] = []) {
    TestBed.resetTestingModule();
    const pubApi = jasmine.createSpyObj<PublicationApi>('pubApi', [
      'clientVideos',
      'clientAccounts',
      'clientReport',
      'clientPrefs',
      'clientCalendar',
    ]);
    pubApi.clientVideos.and.returnValue(of({ items: videos }));
    pubApi.clientReport.and.returnValue(of({ videos_table: [] } as never) as never);
    pubApi.clientPrefs.and.returnValue(of(null as never) as never);
    pubApi.clientCalendar.and.returnValue(of({ days: [], months: [] } as never) as never);
    pubApi.clientAccounts.and.returnValue(
      of({ items: [], secrets_enabled: false } as never) as never,
    );

    const billingApi = jasmine.createSpyObj<BillingApi>('billingApi', ['clientBilling']);
    billingApi.clientBilling.and.returnValue(of({ accruals } as ProjectBilling) as never);

    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: PublicationApi, useValue: pubApi },
        { provide: BillingApi, useValue: billingApi },
        { provide: NzMessageService, useValue: jasmine.createSpyObj('msg', ['error', 'success']) },
      ],
    });
    const fixture = TestBed.createComponent(ClientTurnkeyProjectComponent);
    fixture.componentRef.setInput('project', {
      id: 'pr1',
      kind: 'creators_turnkey',
      title: 'PetFlat · UGC',
      progress: 40,
    } as ProjectClientView);
    fixture.detectChanges();
    return fixture;
  }

  it('у креатора с аватаром в кружке портрет, а кружок ведёт на его страницу', () => {
    const fixture = setup([
      accrual({
        creator_avatar_url: 'https://cdn.example/nastya.jpg',
        creator_username: 'nastya',
      }),
    ]);
    fixture.componentInstance.setTab('posts');
    fixture.detectChanges();

    const link: HTMLAnchorElement = fixture.nativeElement.querySelector('.mrow a.pers');
    expect(link).withContext('кружок обязан быть ссылкой').not.toBeNull();
    expect(link.getAttribute('href')).toBe('/specialist/nastya');

    const img = link.querySelector('img') as HTMLImageElement | null;
    expect(img).withContext('аватар есть — показываем его, а не букву').not.toBeNull();
    expect(img?.getAttribute('src')).toBe('https://cdn.example/nastya.jpg');
  });

  /**
   * Аватара может не быть — человек его не поставил. Тогда остаётся
   * буква, но ссылка остаётся тоже: пропадала бы она, и «почему по
   * одному кликается, а по другому нет» пришлось бы объяснять голосом.
   * Адрес без username идёт по uuid — так же, как везде на сайте.
   */
  it('без аватара остаётся буква, но ссылка сохраняется', () => {
    const fixture = setup([accrual()]);
    fixture.componentInstance.setTab('posts');
    fixture.detectChanges();

    const link: HTMLAnchorElement = fixture.nativeElement.querySelector('.mrow a.pers');
    expect(link.getAttribute('href')).toBe('/specialist/c1-uuid');
    expect(link.querySelector('img')).toBeNull();
    expect(link.textContent?.trim()).toBe('А');
  });

  it('состава ещё нет — так и сказано, а не пустая карточка', () => {
    const fixture = setup([]);
    fixture.componentInstance.setTab('posts');
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Команда появится, когда начнётся период');
  });

  /**
   * Профиль не прошёл модерацию — публичной страницы по его адресу нет,
   * и ссылки быть не должно. Мёртвая ссылка хуже её отсутствия: по ней
   * идут, получают «не найдено» и перестают верить остальным.
   *
   * Человек при этом остаётся на экране целиком — портрет, имя, ролики,
   * сумма: он снимал и за него платят. Пропадает ровно переход.
   */
  it('страницы у человека нет — ссылки нет, а сам человек остаётся', () => {
    const fixture = setup([
      accrual({
        creator_profile_public: false,
        creator_avatar_url: 'https://cdn.example/nastya.jpg',
      }),
    ]);
    fixture.componentInstance.setTab('posts');
    fixture.detectChanges();

    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('.mrow a.pers'))
      .withContext('ссылка на непубликованный профиль ведёт в 404')
      .toBeNull();
    expect(el.querySelector('.mrow a.pers-name'))
      .withContext('имя тоже не должно быть ссылкой — адрес у неё тот же')
      .toBeNull();

    // Сам человек никуда не делся: строка, портрет и имя на месте.
    expect(el.querySelector('.mrow .pers img')).not.toBeNull();
    expect(el.textContent).toContain('Анастасия Креатор');
    // И разница названа словами, а не оставлена на догадки.
    expect(el.textContent)
      .withContext('иначе «почему по одному кликается, а по другому нет» объясняют голосом')
      .toContain('страница ещё не опубликована');
  });

  /**
   * Признака в ответе нет вовсе — старый сервер или строка, собранная не
   * тем путём. Молчание трактуем как «страницы нет»: ссылка, поставленная
   * на догадке, ведёт в 404 ровно в том случае, ради которого признак и
   * заводили.
   */
  it('признак не приехал — ссылки нет', () => {
    const fixture = setup([accrual({ creator_profile_public: undefined })]);
    fixture.componentInstance.setTab('posts');
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.mrow a.pers')).toBeNull();
  });
});

/**
 * Обложка ролика.
 *
 * Настоящего кадра у нас нет и взяться ему неоткуда: ролик лежит на
 * чужой площадке, а мы храним про него ссылку, счётчики и дату —
 * publication_links не хранит ни кадра, ни адреса превью, и в ClientVideo
 * такого поля нет.
 *
 * Значит, единственное, что тут можно сделать правильно, — не
 * притворяться. Пустой серый прямоугольник читался как «картинка не
 * загрузилась», то есть как поломка; знак площадки говорит то, что есть.
 * Тест сторожит обе половины: что картинки нет и что место подписано.
 */
describe('ClientTurnkeyProjectComponent: обложки роликов', () => {
  function video(over: Partial<ClientVideo> = {}): ClientVideo {
    return {
      publication_id: 'p1',
      creator_user_id: 'c1',
      creator_name: 'Анастасия',
      published_at: '2026-09-11T00:00:00Z',
      platforms: ['tiktok', 'vk'],
      links: [],
      views: 2_000_000,
      likes: 66_665,
      comments: 6_665,
      stats_hidden: false,
      ...over,
    } as ClientVideo;
  }

  function setup(videos: ClientVideo[]) {
    TestBed.resetTestingModule();
    const pubApi = jasmine.createSpyObj<PublicationApi>('pubApi', [
      'clientVideos',
      'clientAccounts',
      'clientReport',
      'clientPrefs',
      'clientCalendar',
    ]);
    pubApi.clientVideos.and.returnValue(of({ items: videos }));
    pubApi.clientReport.and.returnValue(of({ videos_table: [] } as never) as never);
    pubApi.clientPrefs.and.returnValue(of(null as never) as never);
    pubApi.clientCalendar.and.returnValue(of({ days: [], months: [] } as never) as never);
    pubApi.clientAccounts.and.returnValue(
      of({ items: [], secrets_enabled: false } as never) as never,
    );
    const billingApi = jasmine.createSpyObj<BillingApi>('billingApi', ['clientBilling']);
    billingApi.clientBilling.and.returnValue(of({} as never) as never);

    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: PublicationApi, useValue: pubApi },
        { provide: BillingApi, useValue: billingApi },
        { provide: NzMessageService, useValue: jasmine.createSpyObj('msg', ['error', 'success']) },
      ],
    });
    const fixture = TestBed.createComponent(ClientTurnkeyProjectComponent);
    fixture.componentRef.setInput('project', {
      id: 'pr1',
      kind: 'creators_turnkey',
      title: 'PetFlat · UGC',
      progress: 40,
    } as ProjectClientView);
    fixture.detectChanges();
    return fixture;
  }

  it('на месте обложки — знак площадки, а не картинка', () => {
    const fixture = setup([video()]);
    const cover: HTMLElement = fixture.nativeElement.querySelector('.vid .cover');

    expect(cover).withContext('место под обложку остаётся: ролик вертикальный').not.toBeNull();
    expect(cover.querySelector('img'))
      .withContext('обложки у внешнего ролика нет — картинке взяться неоткуда')
      .toBeNull();
    expect(cover.textContent?.trim())
      .withContext('пустой прямоугольник читается как «не загрузилось»')
      .toBe('TikTok');
  });

  /**
   * Знак ставит та площадка, что ТЯНЕТ, а не первая в списке: список
   * приходит в порядке базы, и на кадре оказывался Instagram у ролика,
   * две трети просмотров которого пришли из TikTok. Кадр — единственная
   * картинка карточки, и врать ей нельзя.
   */
  it('знак ставит площадка с наибольшими просмотрами, а не первая в списке', () => {
    const fixture = setup([video({ platforms: ['vk', 'tiktok'] })]);
    const cmp = fixture.componentInstance;
    // Без отчёта по площадкам чисел нет ни у кого — тогда порядок
    // остаётся исходным, и это честнее выдуманного первенства.
    expect(cmp.coverPlatform(cmp.videos()[0])).toBe('vk');
  });

  it('площадок нет — знака тоже нет, а не чужой', () => {
    // Выкладка без сданных площадок: подписать её значком первой попавшейся
    // значило бы сказать, где её искать, когда искать негде.
    const fixture = setup([video({ platforms: [] })]);
    const cover: HTMLElement = fixture.nativeElement.querySelector('.vid .cover');
    expect(cover.textContent?.trim()).toBe('');
  });
});

/**
 * Карточка проекта глазами того, кто показывает её начальству.
 *
 * Три правила, каждое из которых до этой правки нарушалось молча:
 *
 *  • в заголовке стоял служебный суффикс конвейера — «(e2e)». В экране,
 *    который вставляют в коммерческое предложение, он читается как
 *    недоделка;
 *  • ссылки на площадки были значками в 26 пикселей без чисел, а сами
 *    числа лежали под вторым кликом. Возможность открыть ролик и
 *    сверить счётчики — то, чего не умеет ни один рекламный отчёт, и
 *    прятать её под раскрытием значит прятать сам аргумент;
 *  • галочки «что мне слать в бот» стояли внутри вкладки «Статистика».
 *    Заказчик открывает статистику при начальстве и показывает вместе с
 *    ней свои личные настройки.
 */
describe('ClientTurnkeyProjectComponent: экран для показа', () => {
  function setup(over: Partial<ProjectClientView> = {}) {
    TestBed.resetTestingModule();
    const pubApi = jasmine.createSpyObj<PublicationApi>('pubApi', [
      'clientVideos',
      'clientAccounts',
      'clientReport',
      'clientPrefs',
      'clientCalendar',
    ]);
    pubApi.clientVideos.and.returnValue(
      of({
        items: [
          {
            publication_id: 'p1',
            creator_user_id: 'c1',
            creator_name: 'Анастасия',
            published_at: '2026-09-15T00:00:00Z',
            platforms: ['vk', 'tiktok'],
            links: [],
            views: 3_000_000,
            likes: 90_000,
            comments: 9_000,
            stats_hidden: false,
          } as ClientVideo,
        ],
      }),
    );
    pubApi.clientReport.and.returnValue(
      of({
        views: 3_000_000,
        likes: 90_000,
        comments: 9_000,
        videos: 1,
        growth_24h: 1_000_000,
        er_percent: 3.3,
        by_platform: [],
        by_day: [],
        videos_table: [
          {
            link_id: 'l1',
            publication_id: 'p1',
            platform: 'tiktok',
            url: 'https://t/1',
            views: 2_000_000,
          },
          {
            link_id: 'l2',
            publication_id: 'p1',
            platform: 'vk',
            url: 'https://v/1',
            views: 150_000,
          },
        ],
      } as never) as never,
    );
    pubApi.clientPrefs.and.returnValue(
      of({ on_new_video: true, on_weekly_digest: true, on_date_shift: true } as never) as never,
    );
    pubApi.clientCalendar.and.returnValue(of({ days: [], months: [] } as never) as never);
    pubApi.clientAccounts.and.returnValue(
      of({ items: [], secrets_enabled: false } as never) as never,
    );

    const billingApi = jasmine.createSpyObj<BillingApi>('billingApi', ['clientBilling']);
    // Состав периода здесь нужен целиком: «Выкладки» проверяются на
    // порядок трёх блоков сразу, и без начислений состав подменился бы
    // строкой «команда появится» — то есть проверялся бы не тот экран.
    billingApi.clientBilling.and.returnValue(
      of({
        accruals: [
          {
            id: 'a1',
            project_id: 'pr1',
            creator_user_id: 'c1-uuid',
            creator_name: 'Анастасия Креатор',
            creator_profile_public: true,
            videos_delivered: 1,
            views_total: 3_000_000,
            salary: 6_000_000,
            views_bonus: 9_900_000,
            total: 15_900_000,
          },
        ],
        totals: { total: 15_900_000 },
        period: {
          seq: 1,
          starts_on: '2026-09-15',
          ends_on: '2026-10-14',
          status: 'open',
          carry_in_client: 0,
          carry_out_client: 0,
        },
      } as never) as never,
    );

    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        // Переписку рисует отдельный виджет со своими запросами, а этот
        // набор ходит и по вкладке «Переписка» тоже: без HttpClient она
        // падала бы в NullInjector, и «вкладок три» проверялось бы на
        // двух из трёх.
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: PublicationApi, useValue: pubApi },
        { provide: BillingApi, useValue: billingApi },
        { provide: NzMessageService, useValue: jasmine.createSpyObj('msg', ['error', 'success']) },
      ],
    });
    const fixture = TestBed.createComponent(ClientTurnkeyProjectComponent);
    fixture.componentRef.setInput('project', {
      id: 'pr1',
      kind: 'creators_turnkey',
      title: 'PetFlat · UGC (e2e)',
      progress: 40,
      ...over,
    } as ProjectClientView);
    fixture.detectChanges();
    return fixture;
  }

  it('служебного суффикса в заголовке нет', () => {
    expect(setup().componentInstance.title()).toBe('PetFlat · UGC');
  });

  /**
   * Режем только скобки в самом конце и только со служебным словом
   * внутри: «Корм для кошек (вертикальные ролики)» — часть названия, и
   * трогать её нельзя.
   */
  it('осмысленные скобки в названии остаются', () => {
    const cmp = setup({ title: 'Корм для кошек (вертикальные ролики)' }).componentInstance;
    expect(cmp.title()).toBe('Корм для кошек (вертикальные ролики)');
  });

  it('ссылка на площадку — цель не меньше 44 px и с числом внутри', () => {
    const el: HTMLElement = setup().nativeElement;
    const links = Array.from(el.querySelectorAll<HTMLAnchorElement>('.opens .go'));
    expect(links.length).toBe(2);
    for (const a of links) {
      expect(a.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
      expect(a.getAttribute('target')).toBe('_blank');
    }
    // Первой — та, что тянет: список приходит в порядке базы, и VK с
    // полутора сотнями тысяч оказывался впереди TikTok с двумя миллионами.
    // Локаль в тестовом окружении не зарегистрирована — сверяем цифры,
    // а не разделитель разрядов.
    expect((links[0].textContent ?? '').replace(/\D/g, '')).toContain('2000000');
  });

  /**
   * Числа по площадкам стоят в самих кнопках, и раскрытия «По площадкам»
   * больше нет: оно было вторым кликом до главного доказательства и
   * показывало ровно то же самое.
   */
  it('чисел по площадкам не надо раскрывать', () => {
    const el: HTMLElement = setup().nativeElement;
    expect(el.querySelector('.det')).toBeNull();
    expect(el.textContent).not.toContain('По площадкам');
  });

  /**
   * Разделов ТРИ, и это весь ряд.
   *
   * Шесть вкладок были шестью ящиками там, где разговоров два с
   * половиной: «что сняли», «когда это выходило» и «кто снимал» — один
   * разговор, «сколько набрали» и «сколько это стоит» — другой. Тест
   * сторожит именно число и имена: седьмая вкладка, добавленная «чтобы
   * не потерялось», возвращает ту же свалку.
   */
  it('вкладок три: Выкладки, Деньги, Переписка', () => {
    const el: HTMLElement = setup().nativeElement;
    const tabs = Array.from(el.querySelectorAll<HTMLElement>('.tabs .tab'));
    expect(tabs.map((t) => (t.textContent ?? '').replace(/\d+/g, '').trim())).toEqual([
      'Выкладки',
      'Деньги',
      'Переписка',
    ]);
  });

  /**
   * «Выкладки»: когда → кто → что, именно в этом порядке.
   *
   * Лента роликов не имеет длины — у идущего проекта в ней полсотни
   * карточек, — и всё, что поставлено под неё, с экрана исчезает. Ровно
   * из-за этого вкладки когда-то и завели: за ответом «когда выходит
   * следующий» приходилось пролистывать всю ленту. Положить ленту первой
   * внутри общей вкладки значит вернуть ту же беду.
   */
  it('во «Выкладках» календарь и состав стоят НАД лентой роликов', () => {
    const fixture = setup();
    fixture.componentInstance.setTab('posts');
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;

    const cal = el.querySelector('app-project-calendar');
    const crew = el.querySelector('.mrow');
    const feed = el.querySelector('.vid');
    expect(cal).withContext('календарь пропал из «Выкладок»').not.toBeNull();
    expect(crew).withContext('состав пропал из «Выкладок»').not.toBeNull();
    expect(feed).withContext('лента пропала из «Выкладок»').not.toBeNull();

    // DOCUMENT_POSITION_FOLLOWING: второй узел идёт ПОСЛЕ первого.
    const after = Node.DOCUMENT_POSITION_FOLLOWING;
    expect(cal!.compareDocumentPosition(crew!) & after)
      .withContext('состав обязан стоять после календаря')
      .toBeTruthy();
    expect(crew!.compareDocumentPosition(feed!) & after)
      .withContext('лента бесконечная — под ней состав уже не найдут')
      .toBeTruthy();
  });

  /**
   * «Деньги»: сколько платить → за что. Вкладку с таким именем открывают
   * ради суммы, а не ради графика; график объясняет сумму и потому стоит
   * под ней. Раньше это были две вкладки, и ответ лежал отдельно от цены.
   */
  it('в «Деньгах» счёт стоит НАД графиком просмотров', () => {
    const fixture = setup();
    fixture.componentInstance.setTab('money');
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;

    const bill = el.querySelector('.billbar, .empty-note');
    const chart = el.querySelector('app-project-stats');
    expect(bill).withContext('счёт пропал из «Денег»').not.toBeNull();
    expect(chart).withContext('график пропал из «Денег»').not.toBeNull();
    expect(bill!.compareDocumentPosition(chart!) & Node.DOCUMENT_POSITION_FOLLOWING)
      .withContext('график встал перед счётом — вкладку открывают ради суммы')
      .toBeTruthy();
  });

  /**
   * Галочки «что мне слать в бот» — не раздел отчёта, и вкладки у них
   * больше нет вовсе. Экран показывают начальству и вставляют в
   * коммерческое: личные настройки в одном клике от отчёта однажды
   * покажут вместе с ним. Живут они полосой внизу и свёрнуты.
   */
  it('уведомлений нет ни в одной вкладке — они свёрнутая полоса внизу', () => {
    const fixture = setup();
    const el: HTMLElement = fixture.nativeElement;

    for (const t of ['posts', 'money', 'talk'] as const) {
      fixture.componentInstance.setTab(t);
      fixture.detectChanges();
      expect(el.querySelector('.tabs .tab.tabend'))
        .withContext(`настройки вернулись в ряд вкладок (${t})`)
        .toBeNull();
      expect(el.textContent)
        .withContext(`галочки развёрнуты в разделе «${t}»`)
        .not.toContain('Ролик вышел на всех площадках');
    }

    // Полоса при этом на месте и раскрывается.
    const toggle = el.querySelector<HTMLButtonElement>('.prefs .prefs-toggle');
    expect(toggle).withContext('настройки пропали совсем — их не найти').not.toBeNull();
    expect(toggle!.getAttribute('aria-expanded')).toBe('false');

    toggle!.click();
    fixture.detectChanges();
    expect(el.textContent).toContain('Ролик вышел на всех площадках');
  });
});
