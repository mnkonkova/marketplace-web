import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { NzMessageService } from 'ng-zorro-antd/message';

import { OrderApi } from '@entities/order/api/order.api';
import { CreatorAvailabilityComponent } from '@widgets/creator-availability/creator-availability.component';

/**
 * Свёрнутый список месяцев на телефоне.
 *
 * Панель второстепенная: шесть месяцев по две кнопки на 390px занимали
 * экран с лишним под тем, за чем в кабинет не заходят. Прячет строки
 * медиазапрос, но число в подписи «Ещё N месяцев» считает компонент —
 * разойдись оно со списком, кнопка обещала бы не то, что разворачивает.
 */
describe('CreatorAvailabilityComponent — свёрнутые месяцы', () => {
  function setup() {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        { provide: OrderApi, useValue: { myAvailability: () => of({ items: [] }) } },
        {
          provide: NzMessageService,
          useValue: { success: () => undefined, error: () => undefined },
        },
      ],
    });
    TestBed.overrideComponent(CreatorAvailabilityComponent, { set: { template: '' } });
    const fixture = TestBed.createComponent(CreatorAvailabilityComponent);
    fixture.detectChanges();
    return fixture.componentInstance;
  }

  it('скрыто ровно столько месяцев, сколько обещает подпись', () => {
    const c = setup();
    expect(c.months().length).toBe(6);
    expect(c.hiddenCount()).toBe(c.months().length - c.visibleOnPhone);
    expect(c.monthWord()).toBe('месяца');
  });

  it('свёрнуто по умолчанию и разворачивается обратно', () => {
    const c = setup();
    expect(c.folded()).toBeTrue();
    c.toggleFold();
    expect(c.folded()).toBeFalse();
    c.toggleFold();
    expect(c.folded()).toBeTrue();
  });
});
