import { TestBed } from '@angular/core/testing';

import type { CreatorEarnings } from '@entities/billing/model/billing.types';
import type { Publication } from '@entities/publication/model/publication.types';
import { CreatorLadderComponent } from '@widgets/creator-ladder/creator-ladder.component';

/**
 * Шкала креатора: что складывается в деньги и что считается «впереди».
 *
 * Арифметику подписей проверяет ladder.spec — здесь то, что живёт в
 * компоненте: правый конец полосы, остаток до ступени и сколько роликов
 * периода ещё не вышло. От последнего зависит, скажет ли экран «сними
 * ещё» там, где снимать негде.
 */
describe('CreatorLadderComponent', () => {
  const PERIOD = {
    seq: 1,
    starts_on: '2026-09-01T00:00:00Z',
    ends_on: '2026-09-30T00:00:00Z',
    status: 'open' as const,
    carry_in_creator: 0,
    carry_out_creator: 0,
  };

  function earnings(over: Partial<CreatorEarnings> = {}): CreatorEarnings {
    return { period: PERIOD, periods: [PERIOD], ...over };
  }

  function pub(over: Partial<Publication> = {}): Publication {
    return {
      id: over.id ?? 'p1',
      project_id: 'pr1',
      creator_user_id: 'c1',
      due_date: '2026-09-10T00:00:00Z',
      status: 'planned',
      created_at: '2026-09-01T00:00:00Z',
      updated_at: '2026-09-01T00:00:00Z',
      links: [],
      overdue: false,
      views: 0,
      likes: 0,
      comments: 0,
      ...over,
    };
  }

  function setup(e: CreatorEarnings | null, pubs: Publication[] = []) {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({});
    TestBed.overrideComponent(CreatorLadderComponent, { set: { template: '' } });
    const fixture = TestBed.createComponent(CreatorLadderComponent);
    fixture.componentRef.setInput('earnings', e);
    fixture.componentRef.setInput('publications', pubs);
    fixture.detectChanges();
    return fixture.componentInstance;
  }

  /**
   * То же, но с настоящей разметкой и стилями.
   *
   * setup выше подменяет шаблон пустым — там проверяют арифметику, и
   * DOM только мешал бы. Здесь проверяется ровно обратное: что человек
   * видит на карточке. Стили нужны по-настоящему: полоса прогресса —
   * это целиком вопрос оформления, и вне браузера её не проверить.
   */
  function render(e: CreatorEarnings | null, pubs: Publication[] = []) {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({});
    const fixture = TestBed.createComponent(CreatorLadderComponent);
    fixture.componentRef.setInput('earnings', e);
    fixture.componentRef.setInput('publications', pubs);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  const FORECAST = {
    step_views: 100_000,
    views_to_go: 100_000,
    carry_in_included: 0,
    forecast_payout: 356_400,
  };

  /**
   * Что осталось до ступени — одной строкой.
   *
   * Раньше на этом месте стояло три абзаца, и один из них считал, сколько
   * плановых выкладок ещё впереди. Абзацы убраны: вместе они читались как
   * объяснение, почему у человека не вышло. Правило «свой добавленный
   * ролик планом не становится» при этом никуда не делось — на нём стоит
   * знаменатель недосдачи, и сторожит его сервер, а не эта карточка.
   */
  describe('что осталось до ступени', () => {
    it('строка считается по остатку и типичному ролику', () => {
      const cmp = setup(
        earnings({
          next_step_forecast: {
            views_to_go: 2_000,
            step_views: 100_000,
            forecast_payout: 100_000,
          } as never,
          benchmark: { typical_video_views: 3_000, typical_video_source: 'creator' } as never,
        }),
      );
      expect(cmp.motivation()).toBe('До следующей ступени — один обычный ролик.');
    });

    it('ориентира нет — в строке стоит число, а не обещание', () => {
      const cmp = setup(
        earnings({
          next_step_forecast: {
            views_to_go: 60_000,
            step_views: 100_000,
            forecast_payout: 100_000,
          } as never,
        }),
      );
      expect(cmp.motivation()).toContain('Один ролик на');
    });
  });

  describe('деньги', () => {
    const accrual = {
      id: 'a1',
      project_id: 'pr1',
      creator_user_id: 'c1',
      period_start: '2026-09-01T00:00:00Z',
      status: 'draft' as const,
      salary: 6_000_000,
      views_base: 0,
      views_over: 0,
      views_total: 0,
      views_bonus: 500_000,
      clicks: 0,
      click_bonus: 0,
      videos_planned: 2,
      videos_delivered: 1,
      deduction: 0,
      total: 6_500_000,
    };

    const forecast = {
      step_views: 100_000,
      views_to_go: 40_000,
      carry_in_included: 0,
      forecast_payout: 356_400,
    };

    it('правый конец полосы — заработанное плюс прогноз ступени', () => {
      const cmp = setup(earnings({ accruals: [accrual], next_step_forecast: forecast }));
      expect(cmp.earned()?.total).toBe(6_500_000);
      expect(cmp.atStep()).toBe(6_500_000 + 356_400);
    });

    /**
     * Начисления по периоду может не быть вовсе: пока его не
     * пересчитывали, строки в базе нет. Складывать не с чем — и
     * выдуманной суммы на полосе появиться не должно.
     */
    it('без начисления суммы на ступени нет, а прогноз остаётся', () => {
      const cmp = setup(earnings({ next_step_forecast: forecast }));
      expect(cmp.earned()).toBeNull();
      expect(cmp.atStep()).toBeNull();
      expect(cmp.forecast()?.forecast_payout).toBe(356_400);
    });

    it('без прогноза правого конца тоже нет: выдумывать его нечем', () => {
      expect(setup(earnings({ accruals: [accrual] })).atStep()).toBeNull();
    });

    // Остаток до ступени сервер считает вместе с перенесённым, а мы про
    // перенос знаем только то, что он уже в счёте. Своя арифметика —
    // запасной вариант, а не второе мнение.
    it('остаток до ступени берётся из прогноза, когда он есть', () => {
      expect(setup(earnings({ next_step_forecast: forecast })).toNext()).toBe(40_000);
    });

    /**
     * Сколько ступеней взято — тоже не своя арифметика.
     *
     * Раньше это стерегла доля пройденного внутри ступени
     * (progressPercent): она бралась из next_step_forecast, а не
     * считалась в браузере. Полосы больше нет, а правило осталось и
     * стало шире: у лесенки число взятых насечек стоит на ИЗМЕРЕННЫХ
     * серверных числах — перенос с прошлого периода плюс просмотры
     * роликов периода, — и ни одно из них браузер не выводит сам.
     * Вторая копия расчёта во фронте разошлась бы с настоящей выплатой
     * молча, и заметили бы это в день выплаты.
     */
    it('взятые ступени считаются из перенесённого и измеренных просмотров', () => {
      const cmp = setup(
        earnings({
          period: { ...PERIOD, carry_in_creator: 250_000 },
          next_step_forecast: forecast,
        }),
        [pub({ id: 'a', published_at: '2026-09-05T00:00:00Z', views: 60_000 })],
      );
      expect(cmp.viewsNow()).toBe(310_000);
      // Ступень закрывается целиком: 310 000 — это три насечки, а не
      // три с хвостом. Хвост живёт в остатке до следующей.
      expect(cmp.ladder().passed).toBe(3);
    });

    it('прогноза нет — считаем по измеренным просмотрам сами', () => {
      const cmp = setup(earnings(), [
        pub({ id: 'a', published_at: '2026-09-05T00:00:00Z', views: 30_000 }),
      ]);
      expect(cmp.toNext()).toBe(70_000);
    });
  });

  /**
   * Добрать до ступени экран говорит ОДИН раз.
   *
   * Было: карточка заработка писала «≈ +3 564 ₽ · осталось 100 тыс.
   * просмотров» и держала кнопку «Добавить ролик», а ниже по странице
   * блок «что делать дальше» повторял те же два числа другими словами и
   * ставил вторую такую же кнопку — да ещё со словом «прогноз», которое
   * на этом экране просили не писать. Ветку `step` из того блока убрали
   * (см. nextStepKind), и единственным домом этого действия осталась
   * карточка. Значит, карточка обязана этот дом держать: уйдёт кнопка
   * отсюда — добирать станет негде вовсе.
   */
  describe('добор до ступени: одно место на экране', () => {
    it('кнопка добора живёт в карточке заработка, и она одна', () => {
      const el = render(earnings({ next_step_forecast: FORECAST }));
      const add = Array.from(el.querySelectorAll('button')).filter(
        (b) => b.textContent?.trim() === 'Добавить ролик',
      );
      expect(add.length).toBe(1);
    });

    it('числа добора стоят рядом с кнопкой — ради них его и делают', () => {
      const el = render(earnings({ next_step_forecast: FORECAST }));
      // Пробелы в сумме неразрывные — сравниваем по обычным, иначе тест
      // проверял бы не число, а способ его набрать.
      const gain = (el.querySelector('.gain')?.textContent ?? '').replace(/\s+/g, ' ');
      expect(gain).toContain('3 564');
      expect(gain).toContain('осталось');
    });

    /**
     * Оговорка «это прогноз, а не начисленное» на карточке есть — знаком
     * «≈». Самого слова быть не должно: его просили убрать, и убирать
     * его надо отовсюду, а не из одного из двух мест.
     */
    it('слова «прогноз» на карточке нет — оговорка живёт знаком «≈»', () => {
      const el = render(earnings({ next_step_forecast: FORECAST }));
      expect(el.textContent?.toLowerCase()).not.toContain('прогноз');
      expect(el.querySelector('.gain')?.textContent).toContain('≈');
    });

    /**
     * Прибавку экран называет ОДИН раз.
     *
     * Правый конец шкалы показывает итог «на следующей ступени» —
     * заработанное плюс прогноз. Начисления по периоду может не быть
     * (пока его не пересчитывали, строки в базе нет), и складывать
     * нечего; раньше на это место вставала сама прибавка — «ступень
     * добавит ≈ +3 564 ₽». Теперь та же прибавка стоит ниже втрое
     * крупнее, и её повтор мелким кеглем прямо над собой читается как
     * второе, другое число.
     */
    it('без начисления конец шкалы молчит, а не повторяет прибавку', () => {
      const el = render(earnings({ next_step_forecast: FORECAST }));
      const to = el.querySelector('.ends .to') as HTMLElement;
      expect(to).withContext('правого конца шкалы нет вовсе').toBeTruthy();
      // Пробелы в сумме неразрывные — сравниваем по обычным, иначе тест
      // проверял бы не число, а способ его набрать.
      expect((to.textContent ?? '').replace(/\s+/g, ' '))
        .withContext('прибавка названа дважды: мелко на шкале и крупно под ней')
        .not.toContain('3 564');
      // Прочерка там тоже нет: пустое место под число — это app-nodata,
      // а прочерк читался бы как «ступень ничего не добавит».
      expect(to.querySelector('app-nodata')).withContext('пустое место не размечено').toBeTruthy();
      // А сама прибавка на карточке никуда не делась.
      expect(el.querySelector('.gain')?.textContent?.replace(/\s+/g, ' ')).toContain('3 564');
    });

    // Подытоженный период: выкладку туда сервер не пустит (409
    // period_locked), и кнопки быть не должно нигде.
    it('период подытожен — кнопки нет: сервер такую выкладку не примет', () => {
      const closed = { ...PERIOD, status: 'locked' as const };
      const el = render({
        period: closed,
        periods: [closed],
        next_step_forecast: FORECAST,
      } as never);
      const add = Array.from(el.querySelectorAll('button')).filter(
        (b) => b.textContent?.trim() === 'Добавить ролик',
      );
      expect(add.length).toBe(0);
    });
  });

  /**
   * Лесенка вместо полосы прогресса.
   *
   * Полоса мерила долю ВНУТРИ одной ступени, и это было не то число:
   * на сороковой ступени она показывала четыре пикселя заливки, то есть
   * «ты ничего не заработал». Насечки меряют пройденное целиком.
   *
   * Требования к нулевому состоянию при этом остались те же и тянут в
   * разные стороны: читаться как НАЧАЛО ПУТИ и при этом не читаться как
   * ПРОЙДЕННЫЙ КУСОК. У лесенки их разводят два разных элемента —
   * взятых насечек ноль, а пунктирная «следующая» стоит на месте.
   */
  describe('лесенка', () => {
    function scale(el: HTMLElement) {
      const node = el.querySelector('app-steps .rungs') as HTMLElement;
      expect(node).withContext('лесенки нет вовсе').toBeTruthy();
      return node;
    }

    function taken(el: HTMLElement): number {
      return scale(el).querySelectorAll('i.on').length;
    }

    it('на нуле взятых насечек нет: шкала не выдаёт непройденное за пройденное', () => {
      const el = render(
        earnings({ next_step_forecast: { ...FORECAST, views_to_go: 100_000 } as never }),
      );
      expect(taken(el)).toBe(0);
    });

    it('на нуле начало пути видно: следующая ступень нарисована пунктиром', () => {
      const el = render(
        earnings({ next_step_forecast: { ...FORECAST, views_to_go: 100_000 } as never }),
      );
      const next = scale(el).querySelector('i.next') as HTMLElement;
      expect(next).withContext('пустая шкала без следующей ступени читается как сбой').toBeTruthy();

      const box = next.getBoundingClientRect();
      expect(box.width).withContext('следующая ступень невидима').toBeGreaterThan(0);
      expect(box.height).withContext('следующая ступень невидима').toBeGreaterThan(0);
      // Контур, а не заливка: залитая «следующая» обещала бы деньги,
      // которых ещё нет.
      expect(getComputedStyle(next).borderStyle).toBe('dashed');
    });

    /**
     * Насечка — это ступень, а не процент. Сколько взято, столько и
     * нарисовано, и каждая насечка одного размера: единица у неё одна
     * (100 000 просмотров) во всех кабинетах.
     */
    it('насечек ровно столько, сколько ступеней взято', () => {
      const el = render(
        earnings({
          period: { ...PERIOD, carry_in_creator: 300_000 },
          next_step_forecast: { ...FORECAST, views_to_go: 40_000 } as never,
        }),
        [pub({ id: 'a', published_at: '2026-09-05T00:00:00Z', views: 60_000 })],
      );
      expect(taken(el)).toBe(3);
    });

    it('насечки одного размера: каждая — одна и та же сотня тысяч', () => {
      const el = render(
        earnings({
          period: { ...PERIOD, carry_in_creator: 300_000 },
          next_step_forecast: { ...FORECAST, views_to_go: 40_000 } as never,
        }),
        [pub({ id: 'a', published_at: '2026-09-05T00:00:00Z', views: 60_000 })],
      );
      const boxes = Array.from(scale(el).querySelectorAll('i.on')).map((n) =>
        (n as HTMLElement).getBoundingClientRect(),
      );
      expect(boxes.length).toBeGreaterThan(1);
      for (const b of boxes) {
        expect(b.width).toBe(boxes[0].width);
        expect(b.height).toBe(boxes[0].height);
        // 9:16 — родная форма вертикального ролика: насечка выше, чем
        // широка, и это не случайность вёрстки.
        expect(b.height).toBeGreaterThan(b.width);
      }
    });

    /**
     * Ступеней стало больше — насечек стало больше. Это и есть разница
     * с полосой: у неё сороковая ступень выглядела так же, как первая.
     */
    it('чем больше просмотров, тем длиннее лесенка', () => {
      const few = render(earnings({ period: { ...PERIOD, carry_in_creator: 200_000 } }), []);
      const fewCount = taken(few);

      const many = render(earnings({ period: { ...PERIOD, carry_in_creator: 2_000_000 } }), []);
      expect(fewCount).toBe(2);
      expect(taken(many)).toBe(20);
    });
  });

  it('периода нет — шкале не от чего отсчитывать', () => {
    const cmp = setup({ periods: [] });
    expect(cmp.period()).toBeNull();
    // Роликов периода без периода не бывает: границ, по которым их
    // отбирают, просто нет.
    expect(cmp.periodVideos().length).toBe(0);
  });
});
