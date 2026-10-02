import { TestBed } from '@angular/core/testing';
import { EMPTY, of, throwError } from 'rxjs';
import { NzMessageService } from 'ng-zorro-antd/message';
import { NzModalService } from 'ng-zorro-antd/modal';

import { OrderApi } from '@entities/order/api/order.api';
import { PublicationApi } from '@entities/publication/api/publication.api';
import type { Publication, VideoRow } from '@entities/publication/model/publication.types';
import { ProjectPublicationsComponent } from '@widgets/project-publications/project-publications.component';

/**
 * Менеджер правит сданную ссылку.
 *
 * Ссылку сдаёт креатор, и ошибается в ней он же: чужой ролик, адрес
 * профиля вместо видео, мобильный домен с обрезанным id. Раньше это
 * чинилось перепиской — менеджер видел, что цифры не собираются, и
 * просил прислать правильную; ролик тем временем набирал просмотры мимо
 * счёта.
 *
 * Здесь проверяется то, за что отвечает экран: что правка уходит в
 * нужную ручку, что «снять ссылку» — отдельное намерение, а не пустая
 * строка по ошибке, и что после правки план перечитывается (у выкладки
 * меняется статус).
 */
describe('ProjectPublicationsComponent: правка ссылки', () => {
  let api: jasmine.SpyObj<PublicationApi>;
  let msg: jasmine.SpyObj<NzMessageService>;

  function row(over: Partial<VideoRow> = {}): VideoRow {
    return {
      publication_id: 'p1',
      link_id: 'l1',
      creator_user_id: 'u1',
      creator_name: 'Анастасия',
      platform: 'tiktok',
      url: 'https://www.tiktok.com/@u/video/111',
      views: 1000,
      likes: 10,
      comments: 1,
      growth_24h: 100,
      submitted_at: '2026-09-10T00:00:00Z',
      ...over,
    };
  }

  function pub(): Publication {
    return {
      id: 'p1',
      project_id: 'pr1',
      creator_user_id: 'u1',
      due_date: '2026-09-11',
      status: 'partial',
      created_at: '2026-09-01T00:00:00Z',
      updated_at: '2026-09-01T00:00:00Z',
      links: [],
      overdue: false,
      views: 0,
      likes: 0,
      comments: 0,
    };
  }

  function setup(editResult?: ReturnType<typeof of>) {
    TestBed.resetTestingModule();
    api = jasmine.createSpyObj<PublicationApi>('api', [
      'managerList',
      'managerCreators',
      'managerReport',
      'managerProjectSettings',
      'managerEditLink',
          // Цифры дособираются при открытии карточки; здесь — «нечего».
      'managerRefreshStats',
    ]);
    api.managerProjectSettings.and.returnValue(
      of({ draft_required: false, client_sees_stats: true }),
    );
    api.managerList.and.returnValue(of({ items: [pub()] }) as never);
    api.managerCreators.and.returnValue(
      of({
        items: [{ user_id: 'u1', display_name: 'Анастасия', added_at: '2026-09-01' }],
      }) as never,
    );
    api.managerReport.and.returnValue(of({ videos_table: [row()] } as never) as never);
    api.managerRefreshStats.and.returnValue(EMPTY as never);
    api.managerEditLink.and.returnValue((editResult ?? of(pub())) as never);

    const orders = jasmine.createSpyObj<OrderApi>('orders', ['managerProjectOrder']);
    orders.managerProjectOrder.and.returnValue(EMPTY);
    msg = jasmine.createSpyObj('msg', ['error', 'success', 'info']);

    TestBed.configureTestingModule({
      providers: [
        { provide: PublicationApi, useValue: api },
        { provide: OrderApi, useValue: orders },
        { provide: NzMessageService, useValue: msg },
        { provide: NzModalService, useValue: jasmine.createSpyObj('modal', ['create', 'confirm']) },
      ],
    });
    TestBed.overrideComponent(ProjectPublicationsComponent, { set: { template: '' } });
    const fixture = TestBed.createComponent(ProjectPublicationsComponent);
    fixture.componentRef.setInput('projectID', 'pr1');
    fixture.componentRef.setInput('kind', 'creators_turnkey');
    fixture.detectChanges();
    return fixture.componentInstance;
  }

  it('форма открывается с текущим адресом — правят, а не набирают заново', () => {
    const cmp = setup();
    cmp.openLinkEdit(row());
    expect(cmp.linkEditFor()?.link_id).toBe('l1');
    expect(cmp.linkEditUrl).toBe('https://www.tiktok.com/@u/video/111');
  });

  it('сохранение уходит в ручку той же площадки', () => {
    const cmp = setup();
    cmp.openLinkEdit(row());
    cmp.linkEditUrl = 'https://www.tiktok.com/@u/video/222';
    cmp.saveLinkEdit();
    expect(api.managerEditLink).toHaveBeenCalledWith(
      'p1',
      'tiktok',
      'https://www.tiktok.com/@u/video/222',
    );
    expect(cmp.linkEditFor()).toBeNull();
  });

  /**
   * Пустое поле — не «снять ссылку». Снятие возвращает выкладку в
   * неполную и убирает её из счёта, и делать это опечаткой нельзя.
   */
  it('пустое поле ничего не отправляет и объясняет почему', () => {
    const cmp = setup();
    cmp.openLinkEdit(row());
    cmp.linkEditUrl = '   ';
    cmp.saveLinkEdit();
    expect(api.managerEditLink).not.toHaveBeenCalled();
    expect(msg.error).toHaveBeenCalled();
  });

  it('«Снять ссылку» шлёт пустой url — это отдельное действие', () => {
    const cmp = setup();
    cmp.openLinkEdit(row());
    cmp.removeLink();
    expect(api.managerEditLink).toHaveBeenCalledWith('p1', 'tiktok', '');
  });

  it('после правки план перечитывается: у выкладки сменился статус', () => {
    const cmp = setup();
    const before = api.managerList.calls.count();
    cmp.openLinkEdit(row());
    cmp.linkEditUrl = 'https://www.tiktok.com/@u/video/333';
    cmp.saveLinkEdit();
    expect(api.managerList.calls.count()).toBeGreaterThan(before);
  });

  it('ошибка сервера показывается и форму не закрывает вслепую', () => {
    const cmp = setup(throwError(() => ({ status: 400, error: { code: 'invalid_input' } })));
    cmp.openLinkEdit(row());
    cmp.linkEditUrl = 'не ссылка';
    cmp.saveLinkEdit();
    expect(msg.error).toHaveBeenCalled();
    expect(cmp.linkBusy()).toBeFalse();
  });

  it('отмена закрывает форму и чистит поле', () => {
    const cmp = setup();
    cmp.openLinkEdit(row());
    cmp.cancelLinkEdit();
    expect(cmp.linkEditFor()).toBeNull();
    expect(cmp.linkEditUrl).toBe('');
  });
});
