import { TestBed } from '@angular/core/testing';
import { EMPTY, of, throwError } from 'rxjs';
import { NzMessageService } from 'ng-zorro-antd/message';
import { NzModalService } from 'ng-zorro-antd/modal';

import { OrderApi } from '@entities/order/api/order.api';
import { PublicationApi } from '@entities/publication/api/publication.api';
import { Publication, PublicationStatus } from '@entities/publication/model/publication.types';
import { ProjectPublicationsComponent } from '@widgets/project-publications/project-publications.component';

// Общая подготовка: компонент грузит выкладки, состав, отчёт и настройки
// одним проходом, и всем группам проверок нужен один и тот же мир.
let api: jasmine.SpyObj<PublicationApi>;

function pub(over: Partial<Publication> = {}): Publication {
  return {
    id: over.id ?? 'p1',
    project_id: 'pr1',
    creator_user_id: 'u1',
    due_date: '2026-09-11',
    status: 'planned' as PublicationStatus,
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

interface Opts {
  draftRequired?: boolean;
  // null — настройки не доехали: ручка ответила ошибкой.
  settings?: null;
  accountLinks?: Record<string, string>;
  report?: unknown;
}

function setup(items: Publication[], opts: Opts = {}) {
  TestBed.resetTestingModule();
  api = jasmine.createSpyObj<PublicationApi>('api', [
    'managerList',
    'managerCreators',
    'managerReport',
    // Переключатели проекта грузятся тем же проходом.
    'managerProjectSettings',
      // Цифры дособираются при открытии карточки; здесь — «нечего».
    'managerRefreshStats',
  ]);
  api.managerProjectSettings.and.returnValue(
    opts.settings === null
      ? (throwError(() => new Error('нет настроек')) as never)
      : of({ draft_required: !!opts.draftRequired, client_sees_stats: true }),
  );
  api.managerList.and.returnValue(of({ items }) as never);
  api.managerCreators.and.returnValue(
    of({
      items: [
        {
          user_id: 'u1',
          display_name: 'Анастасия',
          added_at: '2026-09-01',
          account_links: opts.accountLinks,
        },
      ],
    }) as never,
  );
  api.managerReport.and.returnValue(of((opts.report ?? {}) as never) as never);
  api.managerRefreshStats.and.returnValue(EMPTY as never);

  // Заказ, из которого вырос проект, тем же проходом. Здесь его нет:
  // план выкладок от очереди приглашений не зависит, а EMPTY — это
  // ровно «заказа не было», без выдуманной подборки.
  const orders = jasmine.createSpyObj<OrderApi>('orders', ['managerProjectOrder']);
  orders.managerProjectOrder.and.returnValue(EMPTY);

  TestBed.configureTestingModule({
    providers: [
      { provide: PublicationApi, useValue: api },
      { provide: OrderApi, useValue: orders },
      {
        provide: NzMessageService,
        useValue: jasmine.createSpyObj('msg', ['error', 'success', 'info']),
      },
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

/**
 * План выкладок показывает то, что нужно сдать.
 *
 * Отменённая выкладка снята с плана и ничего не ждёт. Пока такие строки
 * шли вперемешку с живыми, каждая дата дублировалась («11.09 отменена»,
 * «11.09 назначено»), нумерация сбивалась, а план становился вдвое
 * длиннее — прочесть в нём реальную работу было нельзя.
 */
describe('ProjectPublicationsComponent: план', () => {
  it('отменённые в план не попадают', () => {
    const cmp = setup([
      pub({ id: 'a', due_date: '2026-09-11', status: 'cancelled' }),
      pub({ id: 'b', due_date: '2026-09-11' }),
      pub({ id: 'c', due_date: '2026-09-13', status: 'cancelled' }),
      pub({ id: 'd', due_date: '2026-09-13' }),
    ]);

    expect(cmp.ordered().map((p) => p.id)).toEqual(['b', 'd']);
    expect(cmp.cancelledCount()).toBe(2);
  });

  it('нумерация идёт по живым строкам подряд', () => {
    const cmp = setup([
      pub({ id: 'a', due_date: '2026-09-11', status: 'cancelled' }),
      pub({ id: 'b', due_date: '2026-09-12' }),
      pub({ id: 'c', due_date: '2026-09-13' }),
    ]);

    expect(cmp.index(cmp.ordered()[0])).toBe('01');
    expect(cmp.index(cmp.ordered()[1])).toBe('02');
  });

  it('отменённая не горит и не попадает в группу креатора', () => {
    const cmp = setup([
      pub({ id: 'a', due_date: '2026-09-01', status: 'cancelled', overdue: true }),
      pub({ id: 'b', due_date: '2026-09-12' }),
    ]);

    expect(cmp.burning()).toEqual([]);
    const group = cmp.slotGroups().find((g) => g.user_id === 'u1');
    expect(group?.rows.map((r) => r.id)).toEqual(['b']);
    expect(group?.total).toBe(1);
  });
});

/**
 * Колонка «черновик» — свойство проекта, а не строки.
 *
 * Этап согласования выключен — сдавать черновик некому и бот по нему не
 * пингует, значит и столбца быть не должно. Пока он держался на «у
 * кого-то проставлена дата», выключенный этап оставлял на экране колонку
 * с прочерками.
 */
describe('ProjectPublicationsComponent: этап черновика', () => {
  it('этап выключен — колонки нет, даже если даты у строк остались', () => {
    const cmp = setup([pub({ id: 'a', draft_due_date: '2026-09-09' })], { draftRequired: false });

    expect(cmp.hasDrafts()).toBe(false);
  });

  it('этап включён — колонка есть, даже пока дат ещё не проставили', () => {
    const cmp = setup([pub({ id: 'a' })], { draftRequired: true });

    expect(cmp.hasDrafts()).toBe(true);
  });

  it('настройки не доехали — решаем по данным, колонку не теряем', () => {
    const cmp = setup([pub({ id: 'a', draft_due_date: '2026-09-09' })], { settings: null });

    expect(cmp.hasDrafts()).toBe(true);
  });
});

/**
 * Обратный отсчёт у закрытой выкладки.
 *
 * «13.09 · −1 день» красным у строки, где собраны пять ссылок из пяти,
 * означает просрочку, которой нет: срок к закрытой выкладке больше не
 * относится. Дату оставляем — по ней строку находят, — отсчёт гасим.
 */
describe('ProjectPublicationsComponent: обратный отсчёт', () => {
  it('у выложенной выкладки отсчёта нет', () => {
    const cmp = setup([pub({ id: 'a', status: 'done' })]);

    expect(cmp.showCountdown(cmp.ordered()[0])).toBe(false);
  });

  it('у закрытой менеджером вручную — тоже нет', () => {
    const cmp = setup([pub({ id: 'a', status: 'closed_manually' })]);

    expect(cmp.showCountdown(cmp.ordered()[0])).toBe(false);
  });

  it('у назначенной и просроченной отсчёт остаётся: её ещё ждут', () => {
    const cmp = setup([
      pub({ id: 'a', status: 'planned' }),
      pub({ id: 'b', due_date: '2026-09-12', status: 'partial', overdue: true }),
    ]);

    expect(cmp.showCountdown(cmp.ordered()[0])).toBe(true);
    expect(cmp.showCountdown(cmp.ordered()[1])).toBe(true);
  });
});

/**
 * Аккаунты в составе — не то же самое, что собранные ссылки в плане.
 *
 * Чипами площадок рисовались обе вещи сразу, и на одном экране «горит
 * только TT» соседствовало с зелёным «5/5 ссылок». Состав обязан отдавать
 * подпись аккаунта, а не признак «заполнено».
 */
describe('ProjectPublicationsComponent: аккаунты состава', () => {
  it('у заполненной площадки есть ник, у незаполненной — ничего', () => {
    const cmp = setup([pub({ id: 'a' })], {
      accountLinks: { tiktok: 'https://tiktok.com/@nastya' },
    });

    const links = cmp.creators()[0].links;
    const tiktok = links.find((l) => l.platform === 'tiktok')!;
    const reels = links.find((l) => l.platform === 'instagram')!;

    expect(tiktok.label).toBe('TikTok');
    expect(tiktok.handle).toBe('@nastya');
    expect(reels.label).toBe('Reels');
    expect(reels.url).toBeUndefined();
    expect(reels.handle).toBe('');
  });

  it('счётчик ссылок в составе считает ссылки на ролики, а не аккаунты', () => {
    const cmp = setup(
      [
        pub({
          id: 'a',
          status: 'done',
          links: [
            { id: 'l1', platform: 'tiktok', url: 'https://tiktok.com/1', submitted_at: '' },
            { id: 'l2', platform: 'instagram', url: 'https://instagram.com/1', submitted_at: '' },
          ] as Publication['links'],
        }),
      ],
      { accountLinks: { tiktok: 'https://tiktok.com/@nastya' } },
    );

    const row = cmp.creators()[0];
    // Аккаунт заполнен один, ссылок на ролики сдано две — числа разные,
    // и брать одно вместо другого нельзя.
    expect(row.links.filter((l) => !!l.url).length).toBe(1);
    expect(row.linksDone).toBe(2);
    expect(row.linksTotal).toBe(5);
  });
});

/**
 * Таблица «По роликам»: строка — ссылка одного ролика на одной площадке.
 *
 * В колонке «Ролик» стояло слово «ссылка» пять раз подряд — строки
 * отличить было нечем. Номер выкладки тот же, что в плане.
 */
describe('ProjectPublicationsComponent: номер выкладки в отчёте', () => {
  it('номер совпадает с номером строки плана', () => {
    const cmp = setup([
      pub({ id: 'a', due_date: '2026-09-11', status: 'cancelled' }),
      pub({ id: 'b', due_date: '2026-09-12' }),
      pub({ id: 'c', due_date: '2026-09-13' }),
    ]);

    expect(cmp.pubNo('b')).toBe('01');
    expect(cmp.pubNo('c')).toBe('02');
  });

  it('выкладки в плане нет — номера не выдумываем', () => {
    const cmp = setup([pub({ id: 'b' })]);

    expect(cmp.pubNo('нет-такой')).toBe('—');
  });
});

/**
 * ER в отчёте — по площадке, а не по ролику.
 *
 * Строка таблицы «По роликам» это ссылка: один ролик идёт на пять
 * площадок, и у каждой своё отношение реакций к просмотрам. Компонент
 * раскладывает строки отчёта по link_id — если разложить их по
 * publication_id, все пять площадок ролика получат одно и то же число, и
 * колонка перестанет что-либо значить.
 */
describe('ProjectPublicationsComponent: строки отчёта по ссылкам', () => {
  it('две площадки одного ролика несут каждая свои цифры', () => {
    const cmp = setup([pub({ id: 'a', status: 'done' })], {
      report: {
        videos_table: [
          {
            publication_id: 'a',
            link_id: 'l1',
            creator_user_id: 'u1',
            platform: 'tiktok',
            url: 'https://tiktok.com/1',
            views: 2_000_000,
            likes: 60_000,
            comments: 6_000,
            er_percent: 3.3,
            growth_24h: 600_000,
            submitted_at: '2026-09-14T00:00:00Z',
          },
          {
            publication_id: 'a',
            link_id: 'l2',
            creator_user_id: 'u1',
            platform: 'instagram',
            url: 'https://instagram.com/1',
            views: 500_000,
            likes: 40_000,
            comments: 4_000,
            er_percent: 8.8,
            growth_24h: 100_000,
            submitted_at: '2026-09-14T00:00:00Z',
          },
        ],
        by_creator: [],
        by_platform: [],
        by_day: [],
      },
    });

    expect(cmp.linkStat('l1')?.er_percent).toBe(3.3);
    expect(cmp.linkStat('l2')?.er_percent).toBe(8.8);
  });

  it('ссылки без снимка статистики нет и в отчёте', () => {
    const cmp = setup([pub({ id: 'a' })]);

    expect(cmp.linkStat('нет-такой')).toBeUndefined();
  });
});
