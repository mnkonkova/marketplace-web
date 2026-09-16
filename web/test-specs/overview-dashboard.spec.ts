import { TestBed } from '@angular/core/testing';

import {
  RANGE_TABS,
  formatDelta,
  initials,
  parseRange,
  platformShares,
  windowCaption,
} from '@entities/billing/lib/overview';
import type { ClientOverview, OverviewPlatform } from '@entities/billing/model/billing.types';
import { ALL_PLATFORMS } from '@entities/publication/model/publication.types';
import { ClientDashboardComponent } from '@widgets/client-dashboard/client-dashboard.component';

/**
 * Дашборд заказчика: разбор окна, доли площадок и приросты.
 *
 * Проверяем не вёрстку, а те три решения, из-за которых экран может
 * соврать на верных данных: какое окно считается выбранным, из чего
 * складывается полоса состава и чем «прироста нет» отличается от
 * «прирост нулевой».
 */
describe('дашборд заказчика', () => {
  /**
   * Окно живёт в адресе: этот экран показывают начальству и на него дают
   * ссылку, а ссылка на «квартал» обязана открыться кварталом.
   */
  describe('окно из адреса', () => {
    it('три известных окна разбираются как есть', () => {
      expect(parseRange('week')).toBe('week');
      expect(parseRange('month')).toBe('month');
      expect(parseRange('quarter')).toBe('quarter');
    });

    /**
     * С правленым руками адресом человек пришёл смотреть цифры, а не
     * читать про неверный параметр. Месяц по умолчанию потому, что
     * период проекта считается месяцами.
     */
    it('пусто и мусор — месяц, а не ошибка', () => {
      expect(parseRange(null)).toBe('month');
      expect(parseRange(undefined)).toBe('month');
      expect(parseRange('')).toBe('month');
      expect(parseRange('вчера')).toBe('month');
      expect(parseRange('year')).toBe('month');
    });

    it('регистр и пробелы адресу прощаются', () => {
      expect(parseRange(' Week ')).toBe('week');
      expect(parseRange('QUARTER')).toBe('quarter');
    });

    it('переключатель предлагает ровно эти три окна, от короткого к длинному', () => {
      expect([...RANGE_TABS]).toEqual(['week', 'month', 'quarter']);
    });
  });

  /**
   * Подпись под именем заказчика отвечает на «за что эти числа». Без неё
   * оконное число стоит на экране рядом с итогом за всё время
   * неотличимым от него.
   */
  describe('подпись окна', () => {
    it('границы окна приходят с сервера готовой строкой', () => {
      expect(windowCaption('month', '17 авг. — 15 сент. 2026')).toBe(
        'Все площадки · 17 авг. — 15 сент. 2026',
      );
    });

    /**
     * Пустое место после «Все площадки ·» читается как недогруз, а не
     * как отсутствие подписи. Поэтому окно называем словом.
     */
    it('без подписи с сервера окно называется словом', () => {
      expect(windowCaption('week')).toBe('Все площадки · за неделю');
      expect(windowCaption('month', '  ')).toBe('Все площадки · за месяц');
      expect(windowCaption('quarter', undefined)).toBe('Все площадки · за квартал');
    });
  });

  describe('доли площадок', () => {
    function platform(over: Partial<OverviewPlatform> & { platform: string }): OverviewPlatform {
      return { views: 0, share_pct: 0, series: [], ...over };
    }

    const rows: OverviewPlatform[] = [
      platform({ platform: 'tiktok', views: 900, window_views: 670, window_share_pct: 67 }),
      platform({ platform: 'instagram', views: 200, window_views: 170, window_share_pct: 17 }),
      platform({ platform: 'youtube', views: 150, window_views: 100, window_share_pct: 10 }),
      platform({ platform: 'vk', views: 90, window_views: 50, window_share_pct: 5 }),
      platform({ platform: 'likee', views: 30, window_views: 10, window_share_pct: 2 }),
    ];

    /**
     * Дашборд весь оконный. Возьми он числа за всё время — доли не
     * сошлись бы с главным числом героя, и человек, сложив их, получил
     * бы третью величину, которой нет нигде.
     */
    it('в дашборд идут ОКОННЫЕ просмотры, а не итог за всё время', () => {
      const tiktok = platformShares(rows).find((r) => r.platform === 'tiktok')!;
      expect(tiktok.views).toBe(670);
      expect(tiktok.percent).toBe(67);
    });

    it('порядок — по убыванию вклада: сверху та, что тянет', () => {
      expect(platformShares(rows).map((r) => r.platform)).toEqual([
        'tiktok',
        'instagram',
        'youtube',
        'vk',
        'likee',
      ]);
    });

    /**
     * Пропавшая карточка читается как сбой, а не как ноль: человек ищет,
     * куда делся Likee, вместо того чтобы прочитать «на Likee пока
     * ничего».
     */
    it('площадок всегда пять, включая те, которых в ответе нет', () => {
      const out = platformShares([rows[0]]);
      expect(out.length).toBe(5);
      const likee = out.find((r) => r.platform === 'likee')!;
      expect(likee.views).toBe(0);
      expect(likee.width).toBe(0);
    });

    it('площадка, которой у нас нет, в дашборд не попадает', () => {
      const out = platformShares([...rows, platform({ platform: 'threads', views: 999 })]);
      expect(out.map((r) => r.platform)).not.toContain('threads' as never);
      expect(out.length).toBe(5);
    });

    /**
     * Ширину куска считаем из просмотров, а не из округлённой доли:
     * округлённые до целых доли пяти площадок дают в сумме то 99, то 101
     * процент, и полоса состава либо не сходится справа, либо
     * переполняется.
     */
    it('куски полосы в сумме дают ровно сто процентов', () => {
      const sum = platformShares(rows).reduce((s, r) => s + r.width, 0);
      expect(sum).toBeCloseTo(100, 6);
    });

    it('ширина считается из просмотров, даже когда доли сервера не сходятся', () => {
      const skewed = [
        platform({ platform: 'tiktok', window_views: 1, window_share_pct: 60 }),
        platform({ platform: 'vk', window_views: 1, window_share_pct: 60 }),
      ];
      const out = platformShares(skewed);
      expect(out.find((r) => r.platform === 'tiktok')!.width).toBeCloseTo(50, 6);
      // В легенде при этом остаётся число сервера: это то же число,
      // которым он оперирует в своих отчётах.
      expect(out.find((r) => r.platform === 'tiktok')!.percent).toBe(60);
    });

    it('просмотров нет вовсе — полоса пустая, а не делённая на ноль', () => {
      const out = platformShares([]);
      expect(out.every((r) => r.width === 0 && r.percent === 0)).toBeTrue();
    });

    /**
     * Пока бэкенд раскатывается, `platforms` может не приехать. Тогда
     * состав рисуется по старому разрезу за всё время — окна на таком
     * ответе всё равно нет.
     */
    it('без разреза по площадкам состав берётся из старого by_platform', () => {
      const out = platformShares(undefined, { tiktok: 300, vk: 100 });
      expect(out[0].platform).toBe('tiktok');
      expect(out[0].width).toBeCloseTo(75, 6);
      expect(out[0].percent).toBe(75);
    });
  });

  describe('прирост', () => {
    /**
     * Это и есть то различие, ради которого функция вообще существует.
     * Поля может не быть — сравнивать не с чем; и это НЕ ноль: ноль
     * означает «сравнили и не изменилось». Подменять отсутствие нулём —
     * рисовать зелёную стрелку там, где мы просто не знаем.
     */
    it('прироста нет — прочерк, без стрелки и без цвета', () => {
      const d = formatDelta(undefined);
      expect(d.known).toBeFalse();
      expect(d.text).toBe('—');
      expect(d.arrow).toBe('');
      expect(d.tone).toBe('flat');
    });

    it('null и не-число — то же самое: сравнивать не с чем', () => {
      expect(formatDelta(null).known).toBeFalse();
      expect(formatDelta(Number.NaN).known).toBeFalse();
    });

    it('прирост нулевой — это измеренный ноль, а не пустота', () => {
      const d = formatDelta(0);
      expect(d.known).toBeTrue();
      expect(d.text).toBe('0%');
      // Стрелка означает направление, а направления здесь нет.
      expect(d.arrow).toBe('');
      expect(d.tone).toBe('flat');
    });

    it('рост — вверх и со знаком', () => {
      const d = formatDelta(34);
      expect(d.text).toBe('+34%');
      expect(d.arrow).toBe('↑');
      expect(d.tone).toBe('up');
    });

    /**
     * Отчёт, который умеет показывать только хорошее, перестают читать
     * вовсе — и вместе с ним перестают верить хорошим числам.
     */
    it('падение показывается падением, а не прячется', () => {
      const d = formatDelta(-12);
      expect(d.text).toBe('−12%');
      expect(d.arrow).toBe('↓');
      expect(d.tone).toBe('down');
    });

    /** У ER прирост в пунктах: «вырос на 7%» от 4,4% читается двояко. */
    it('у ER прирост в пунктах и с запятой', () => {
      expect(formatDelta(-0.3, 'pp').text).toBe('−0,3\u00a0п.\u00a0п.');
      expect(formatDelta(2, 'pp').text).toBe('+2,0\u00a0п.\u00a0п.');
      expect(formatDelta(0, 'pp').text).toBe('0,0\u00a0п.\u00a0п.');
    });
  });

  describe('инициалы в шапке', () => {
    it('две первые буквы имени и фамилии', () => {
      expect(initials('Олег Исаев')).toBe('ОИ');
      expect(initials('  анна   петрова  сергеевна ')).toBe('АП');
    });

    it('имени нет — кружок не пустует', () => {
      expect(initials('')).toBe('·');
      expect(initials(undefined)).toBe('·');
    });
  });
});

/**
 * Разбор по площадкам рисуется в реальном браузере и меряется линейкой.
 *
 * Пять одинаковых карточек стояли в ряд при разнице в сорок раз: TikTok
 * с двумя миллионами и Likee с пятьюдесятью тысячами занимали одинаковые
 * прямоугольники — то есть карточки скрывали ровно то, ради чего разбор
 * и смотрят. Теперь это ранжированный список с полосой, длина которой
 * пропорциональна просмотрам.
 *
 * Правило «площадок всегда пять, включая пустые» осталось прежним и
 * переехало сюда вместе с разметкой: пропавшая строка читается как сбой,
 * а не как ноль.
 */
describe('дашборд заказчика: разбор по площадкам', () => {
  function overview(): ClientOverview {
    const series = [
      { date: '2026-09-10', views_gained: 1200 },
      { date: '2026-09-11', views_gained: 800 },
      // Дыра: линия здесь рвётся, и это тоже часть картинки.
      { date: '2026-09-14', views_gained: 2400 },
    ];
    return {
      projects_total: 1,
      projects: [],
      views: { total: 3_000_000 },
      money: { locked: 0, current: 0, total: 0, paid: 0 },
      series: [],
      generated_at: '2026-09-14T00:00:00Z',
      range: 'month',
      range_label: '17 авг. — 15 сент. 2026',
      window: { views: 3_000_000, engagement: 48_700, comments: 2752, er_percent: 3.3 },
      platforms: ALL_PLATFORMS.map((platform, i) => ({
        platform,
        views: 1000 * (5 - i),
        share_pct: 20,
        window_views: 1000 * (5 - i),
        window_share_pct: 20,
        er_percent: 3.3,
        series,
      })),
    } as unknown as ClientOverview;
  }

  function render(data: ClientOverview = overview()): HTMLElement {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({});
    const fixture = TestBed.createComponent(ClientDashboardComponent);
    fixture.componentRef.setInput('data', data);
    fixture.componentRef.setInput('range', 'month');
    fixture.componentRef.setInput('clientName', 'Олег Исаев');
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  it('площадок в списке всегда пять, даже нулевых', () => {
    const data = overview();
    // Likee в ответе нет вовсе — строка обязана остаться.
    data.platforms = data.platforms!.filter((p) => p.platform !== 'likee');
    expect(render(data).querySelectorAll('.rank li').length).toBe(5);
  });

  /**
   * Полоса — это и есть разбор: при разнице в сорок раз она обязана
   * отличаться в сорок раз. Одинаковые полосы вернули бы ту же ложь, что
   * пять одинаковых карточек.
   */
  it('длина полосы пропорциональна просмотрам, а не одинакова', () => {
    const bars = Array.from(render().querySelectorAll<HTMLElement>('.rank .track b'));
    expect(bars.length).toBe(5);
    const widths = bars.map((b) => b.getBoundingClientRect().width);
    // Первая площадка втрое больше пятой по числам — и полоса тоже.
    expect(widths[0]).toBeGreaterThan(widths[4] * 2);
    for (let i = 1; i < widths.length; i++) {
      expect(widths[i]).toBeLessThanOrEqual(widths[i - 1] + 0.5);
    }
  });

  it('ничто из строки не вылезает за её рамку', () => {
    for (const row of Array.from(render().querySelectorAll<HTMLElement>('.rank li'))) {
      const box = row.getBoundingClientRect();
      for (const child of Array.from(row.querySelectorAll<HTMLElement>('*'))) {
        const c = child.getBoundingClientRect();
        // Полпикселя допуска: субпиксельная раскладка, а не протёкший
        // наружу элемент.
        expect(c.bottom).toBeLessThanOrEqual(box.bottom + 0.5);
        expect(c.right).toBeLessThanOrEqual(box.right + 0.5);
      }
    }
  });

  /**
   * Прочерка на этом экране нет нигде.
   *
   * Было четыре плитки с «—» под числами и строка «Сравнивать не с чем»
   * прямо под главным числом: у нового проекта прошлого такого же окна
   * ещё нет, и сравнивать не с чем НИГДЕ. Прочерк при этом читается как
   * ноль — мы утверждали то, чего не знаем, в пяти местах сразу.
   *
   * Это преемник прежней проверки «оговорка сказана один раз на блок»:
   * теперь её не должно быть вовсе, потому что нет и самих пустых
   * слотов.
   */
  it('ни прочерка вместо числа, ни извинения «сравнивать не с чем»', () => {
    const el = render();
    expect(el.textContent ?? '').not.toContain('Сравнивать не с чем');
    // Тире как ЗНАЧЕНИЕ, а не как знак препинания: ищем элементы, весь
    // текст которых — один прочерк. Тире внутри «17 авг. — 15 сент.» это
    // пунктуация, и запрещать её незачем.
    const dashes = Array.from(el.querySelectorAll('*')).filter(
      (n) => (n.textContent ?? '').trim() === '\u2014',
    );
    expect(dashes.length).toBe(0);
  });
});
