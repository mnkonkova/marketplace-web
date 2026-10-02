import type { Publication, VideoRow } from '@entities/publication/model/publication.types';
import {
  buildVideoMatrix,
  cellValue,
  heat,
  matrixMax,
  summarize,
} from '@entities/publication/lib/video-matrix';

/**
 * Таблица «ролик × площадка» у менеджера.
 *
 * Главное, что здесь проверяется, — что отсутствие числа не становится
 * нулём: «ссылки нет», «ещё не собирали» и «посмотрели ноль раз» —
 * три разных ответа, и менеджер действует по ним по-разному.
 */
describe('таблица роликов по площадкам', () => {
  function pub(over: Partial<Publication> = {}): Publication {
    return {
      id: 'p1',
      project_id: 'pr1',
      creator_user_id: 'u1',
      creator_name: 'Анастасия',
      due_date: '2026-09-04',
      status: 'done',
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

  function row(over: Partial<VideoRow> = {}): VideoRow {
    return {
      publication_id: 'p1',
      link_id: 'l1',
      creator_user_id: 'u1',
      platform: 'tiktok',
      url: 'https://tiktok.com/@a/video/1',
      views: 1000,
      likes: 50,
      comments: 5,
      growth_24h: 100,
      er_percent: 5.5,
      submitted_at: '2026-09-04T10:00:00Z',
      collected_at: '2026-09-05T03:00:00Z',
      ...over,
    };
  }

  it('площадка без ссылки — «нет ссылки», а не ноль', () => {
    const m = buildVideoMatrix([pub()], [row()]);
    expect(m.videos.length).toBe(1);
    expect(m.videos[0].cells.tiktok.kind).toBe('ok');
    expect(m.videos[0].cells.youtube.kind).toBe('none');
    expect(cellValue(m.videos[0].cells.youtube, 'views')).toBeNull();
    expect(m.videos[0].missing).toEqual(['instagram', 'youtube', 'vk', 'likee']);
  });

  it('ссылка без снимка — «собираем»: нули из COALESCE не выдаются за просмотры', () => {
    const m = buildVideoMatrix(
      [pub()],
      [row(), row({ link_id: 'l2', platform: 'vk', views: 0, collected_at: undefined })],
    );
    expect(m.videos[0].cells.vk.kind).toBe('pending');
    expect(cellValue(m.videos[0].cells.vk, 'views')).toBeNull();
    // Ссылка сдана — в счётчик ссылок площадки она входит.
    expect(m.totals.find((t) => t.platform === 'vk')?.links).toBe(1);
    expect(m.videos[0].missing).not.toContain('vk');
  });

  it('сборщик отказал — «failed» с причиной, а не «собираем» и не ноль', () => {
    const reason = "Метрики отдельных постов для 'vk' пока не поддержаны";
    const m = buildVideoMatrix(
      [pub()],
      [
        row(),
        row({ link_id: 'l2', platform: 'vk', views: 0, collected_at: undefined, collect_error: reason }),
      ],
    );
    const vk = m.videos[0].cells.vk;
    expect(vk.kind).toBe('failed');
    expect(vk.kind === 'failed' && vk.reason).toBe(reason);
    expect(cellValue(vk, 'views')).toBeNull();
    // В сумму ролика отказ не входит ни нулём, ни чем-то ещё.
    expect(m.videos[0].views).toBe(1000);
  });

  it('сумма ролика складывается по площадкам', () => {
    const m = buildVideoMatrix(
      [pub()],
      [
        row({ views: 1000, growth_24h: 100 }),
        row({ link_id: 'l2', platform: 'instagram', views: 500, growth_24h: 20 }),
      ],
    );
    expect(m.videos[0].views).toBe(1500);
    expect(m.videos[0].growth).toBe(120);
    expect(m.views).toBe(1500);
  });

  it('прирост неизвестен хоть по одной ссылке — неизвестен и в сумме', () => {
    const m = buildVideoMatrix(
      [pub()],
      [row({ growth_24h: 100 }), row({ link_id: 'l2', platform: 'instagram', growth_24h: null })],
    );
    expect(m.videos[0].growth).toBeNull();
    expect(m.growth).toBeNull();
    expect(m.totals.find((t) => t.platform === 'tiktok')?.growth).toBe(100);
  });

  it('ER итога взвешен по просмотрам', () => {
    const m = buildVideoMatrix(
      [pub()],
      [
        row({ views: 900, er_percent: 10 }),
        row({ link_id: 'l2', platform: 'instagram', views: 100, er_percent: 0 }),
      ],
    );
    expect(m.videos[0].er).toBeCloseTo(9, 5);
  });

  it('без просмотров ER нет вовсе, а не 0 %', () => {
    const m = buildVideoMatrix([pub()], [row({ views: 0, er_percent: undefined })]);
    expect(m.videos[0].er).toBeNull();
  });

  it('будущая выкладка без ссылок и отменённая в таблицу не попадают', () => {
    const m = buildVideoMatrix(
      [
        pub({ id: 'p1' }),
        pub({ id: 'p2', status: 'planned', due_date: '2026-09-20' }),
        pub({ id: 'p3', status: 'cancelled' }),
      ],
      [row(), row({ publication_id: 'p3', link_id: 'l3' })],
      '2026-09-10',
    );
    expect(m.videos.map((v) => v.publicationId)).toEqual(['p1']);
  });

  it('срок наступил, а ссылок нет — строка есть, все площадки пустые', () => {
    const m = buildVideoMatrix(
      [pub({ id: 'late', status: 'planned', due_date: '2026-09-05' })],
      [],
      '2026-09-10',
    );
    expect(m.videos.length).toBe(1);
    expect(m.videos[0].missing.length).toBe(5);
    expect(m.videos[0].views).toBe(0);
  });

  it('без названия — номер выкладки из плана, новые сверху', () => {
    const m = buildVideoMatrix(
      [
        pub({ id: 'a', due_date: '2026-09-01' }),
        pub({ id: 'b', due_date: '2026-09-10', title: 'Утро с мейн-куном' }),
      ],
      [row({ publication_id: 'a' }), row({ publication_id: 'b', link_id: 'l2' })],
    );
    expect(m.videos.map((v) => v.title)).toEqual(['Утро с мейн-куном', 'Выкладка 01']);
  });

  it('итог по креатору — из его роликов, номера выкладок — по всему плану', () => {
    const m = buildVideoMatrix(
      [
        pub({ id: 'a', creator_user_id: 'u1', due_date: '2026-09-01' }),
        pub({ id: 'b', creator_user_id: 'u2', creator_name: 'Игорь', due_date: '2026-09-02' }),
      ],
      [
        row({ publication_id: 'a', views: 700 }),
        row({ publication_id: 'b', link_id: 'l2', creator_user_id: 'u2', views: 300 }),
      ],
    );
    expect(m.views).toBe(1000);
    const igor = m.videos.filter((v) => v.creatorUserId === 'u2');
    expect(summarize(igor).views).toBe(300);
    expect(summarize(igor).totals.find((t) => t.platform === 'tiktok')?.links).toBe(1);
    // Отфильтровали Игоря — его выкладка всё равно вторая по плану.
    expect(igor[0].title).toBe('Выкладка 02');
  });

  it('насыщенность: корень доли, без числа — ноль', () => {
    expect(heat(100, 100)).toBe(1);
    expect(heat(25, 100)).toBe(0.5);
    expect(heat(null, 100)).toBe(0);
    expect(heat(10, 0)).toBe(0);
    const m = buildVideoMatrix(
      [pub()],
      [row({ views: 400 }), row({ link_id: 'l2', platform: 'vk', views: 100 })],
    );
    expect(matrixMax(m, 'views')).toBe(400);
    expect(matrixMax(m, 'er')).toBe(5.5);
  });
});
