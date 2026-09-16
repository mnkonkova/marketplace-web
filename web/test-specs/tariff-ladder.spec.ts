import { TestBed } from '@angular/core/testing';

import type { OverviewTariff } from '@entities/billing/model/billing.types';
import { TariffLadderComponent } from '@widgets/tariff-ladder/tariff-ladder.component';

/**
 * Тарифная лесенка — главный коммерческий аргумент кабинета.
 *
 * На экране стоял результат формулы («56 ₽ за тысячу») и не стояла сама
 * формула, а весь аргумент «чем больше просмотров, тем дешевле тысяча»
 * живёт именно в ней: первые просмотры КАЖДОГО ролика идут по стартовой
 * ставке, всё сверх — по пониженной.
 *
 * Стеречь здесь надо три вещи, и каждая из них однажды соврала бы тихо:
 *
 *  • лесенка показывает ровно то, что посчитал сервер, и НИЧЕГО НЕ
 *    СЧИТАЕТ САМА. Вторая реализация ступеней в браузере разошлась бы со
 *    счётом молча — заметили бы в день оплаты;
 *  • порог назван «на каждый ролик». У пяти роликов по 400 000
 *    сверхпорогового объёма нет вовсе, и «первый миллион проекта»
 *    описывал бы чужое правило;
 *  • сумма ступеней сходится с итогом, а итог делится в цену тысячи,
 *    которая стоит рядом. Это первое, что проверяют калькулятором.
 */
describe('TariffLadderComponent', () => {
  /** Числа стенда: 90 ₽ до миллиона на ролик, 9 ₽ сверх, фикс 60 000 ₽. */
  function tariff(over: Partial<OverviewTariff> = {}): OverviewTariff {
    return {
      threshold_views: 1_000_000,
      rate_per_1000: 9_000,
      rate_per_1000_over: 900,
      views_base: 1_000_000,
      views_over: 2_000_000,
      base_amount: 9_000_000,
      over_amount: 1_800_000,
      fixed: 6_000_000,
      views: 3_000_000,
      total: 16_800_000,
      ...over,
    };
  }

  function render(t: OverviewTariff, cost: number | null = 5600): HTMLElement {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({});
    const fixture = TestBed.createComponent(TariffLadderComponent);
    fixture.componentRef.setInput('tariff', t);
    fixture.componentRef.setInput('costPer1000', cost);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  function texts(el: HTMLElement, sel: string): string[] {
    return Array.from(el.querySelectorAll(sel)).map((n) => (n.textContent ?? '').trim());
  }

  it('обе ставки стоят на экране: 90 ₽ на старте и 9 ₽ на разгоне', () => {
    const rates = texts(render(tariff()), '.lrow .rate').join(' | ');
    expect(rates).toContain('90');
    expect(rates).toContain('9 ₽');
  });

  /**
   * Падение ставки — это и есть аргумент, и цветом оно тоже сказано:
   * латунь на стартовой, лёд на пониженной. Лёд здесь не «плохо»:
   * упавшая цена тысячи — то, что мы продаём.
   */
  it('старт латунный, разгон ледяной — падение видно цветом, а не только числом', () => {
    const el = render(tariff());
    expect(el.querySelector('.lrow .rate.brass')).not.toBeNull();
    expect(el.querySelector('.lrow .rate.ice')).not.toBeNull();
  });

  it('порог назван на КАЖДЫЙ ролик, а не на проект', () => {
    const text = render(tariff()).textContent ?? '';
    expect(text).toContain('каждого ролика');
    expect(text).not.toContain('проекта');
  });

  /**
   * Три строки, и третья обязательна. Без работы команды сумма ступеней
   * не сходится с итогом, и лесенка превращается в счёт, в котором не
   * хватает слагаемого.
   */
  it('суммы ступеней складываются в итог, который показан рядом', () => {
    const el = render(tariff());
    const amounts = texts(el, '.lrow .amt');
    expect(amounts.length).toBe(3);
    const digits = (s: string): number => Number(s.replace(/\D/g, ''));
    expect(digits(amounts[0]) + digits(amounts[1]) + digits(amounts[2])).toBe(
      digits(texts(el, '.sumrow .total')[0]),
    );
  });

  /**
   * Делим на ТЫСЯЧИ, а не на просмотры: «168 000 ₽ ÷ 3 000 000 = 56 ₽»
   * не сходится, и человек с калькулятором это увидит первым же заходом.
   */
  it('в подписи деления стоят тысячи просмотров, а не просмотры', () => {
    const calc = texts(render(tariff()), '.sumrow .calc')[0];
    expect(calc).toContain('3 000 тысяч');
    expect(calc).toContain('56 ₽');
  });

  /**
   * Частное приходит готовым из счёта. Посчитай лесенка его сама —
   * получилась бы вторая реализация денег в браузере, и разошлась бы она
   * молча: 16 800 000 / 3000 в целых копейках и в рублях дают разные
   * последние знаки.
   */
  it('цены тысячи нет в счёте — деления в подписи тоже нет, а не выдуманное', () => {
    const calc = texts(render(tariff(), null), '.sumrow .calc')[0];
    expect(calc).toBe('');
  });

  /**
   * Полоса показывает соотношение ступеней В ПРОСМОТРАХ. Не совпади она
   * со строками под ней — на экране появилось бы третье число, которого
   * нет нигде.
   */
  it('полоса делится в том же отношении, что и просмотры ступеней', () => {
    const el = render(tariff());
    const a = el.querySelector<HTMLElement>('.split .a')!;
    const b = el.querySelector<HTMLElement>('.split .b')!;
    expect(Number(a.style.flexGrow)).toBe(1_000_000);
    expect(Number(b.style.flexGrow)).toBe(2_000_000);
    // И геометрией: разгон вдвое длиннее старта.
    expect(b.getBoundingClientRect().width).toBeGreaterThan(a.getBoundingClientRect().width * 1.5);
  });
});
