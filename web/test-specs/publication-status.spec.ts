import {
  canSubmitLinks,
  closedCount,
  daysLeft,
  dueLabel,
  isOpen,
  linksCollected,
  missingPlatforms,
  publicationBadge,
} from '@entities/publication/lib/publication-status';
import { requiredUnchecked } from '@entities/publication/lib/checklist';
import {
  ChecklistItem,
  Platform,
  Publication,
  PublicationStatus,
} from '@entities/publication/model/publication.types';

function pub(over: Partial<Publication> = {}): Publication {
  return {
    id: 'p1',
    project_id: 'pr1',
    creator_user_id: 'u1',
    due_date: '2026-08-24T00:00:00Z',
    status: 'planned',
    created_at: '2026-08-01T00:00:00Z',
    updated_at: '2026-08-01T00:00:00Z',
    links: [],
    overdue: false,
    views: 0,
    likes: 0,
    comments: 0,
    ...over,
  };
}

function link(platform: Platform) {
  return {
    id: `l-${platform}`,
    publication_id: 'p1',
    platform,
    url: `https://${platform}.example/1`,
    url_canonical: `https://${platform}.example/1`,
    submitted_at: '2026-08-20T00:00:00Z',
  };
}

function item(over: Partial<ChecklistItem> = {}): ChecklistItem {
  return {
    id: 'i1',
    project_id: 'pr1',
    text: 'Товар в кадре первые 3 секунды',
    is_required: true,
    sort_order: 1,
    ...over,
  };
}

describe('publicationBadge', () => {
  it('отменённая выкладка не «просрочена», даже если бэк прислал overdue', () => {
    const b = publicationBadge(pub({ status: 'cancelled', overdue: true }));
    expect(b.label).toBe('Отменена');
    expect(b.tone).toBe('neutral');
  });

  it('закрытая менеджером показывается отдельно от «выложено»', () => {
    expect(publicationBadge(pub({ status: 'closed_manually' })).label).toBe('Закрыта менеджером');
  });

  it('done — «Выложено», зелёный', () => {
    const b = publicationBadge(pub({ status: 'done', links: [link('tiktok')] }));
    expect(b.label).toBe('Выложено');
    expect(b.color).toBe('green');
    expect(b.tone).toBe('ok');
  });

  it('просрочка перебивает и «назначено», и «частично»', () => {
    expect(publicationBadge(pub({ status: 'planned', overdue: true })).label).toBe('Просрочено');
    expect(publicationBadge(pub({ status: 'partial', overdue: true })).label).toBe('Просрочено');
  });

  it('непринятая просьба о переносе показывается вместо «назначено»', () => {
    const b = publicationBadge(
      pub({
        pending_date_request: {
          id: 'd1',
          publication_id: 'p1',
          requested_date: '2026-08-28T00:00:00Z',
          reason: 'съёмка сорвалась',
          status: 'pending',
          created_at: '2026-08-24T00:00:00Z',
        },
      }),
    );
    expect(b.label).toBe('Ждёт переноса');
  });

  it('partial без просрочки — «Выложено частично»', () => {
    expect(publicationBadge(pub({ status: 'partial', links: [link('vk')] })).label).toBe(
      'Выложено частично',
    );
  });

  it('planned без просрочки — «Назначено»', () => {
    expect(publicationBadge(pub()).label).toBe('Назначено');
  });
});

describe('isOpen / canSubmitLinks', () => {
  const cases: [PublicationStatus, boolean][] = [
    ['planned', true],
    ['partial', true],
    ['done', false],
    ['closed_manually', false],
    ['cancelled', false],
  ];

  cases.forEach(([status, open]) => {
    it(`${status} → ${open ? 'ждёт ссылок' : 'закрыта'}`, () => {
      expect(isOpen(status)).toBe(open);
      expect(canSubmitLinks(pub({ status }))).toBe(open);
    });
  });
});

describe('missingPlatforms', () => {
  it('возвращает недостающие площадки в порядке бэка', () => {
    const p = pub({ links: [link('youtube'), link('tiktok')] });
    expect(missingPlatforms(p)).toEqual(['instagram', 'vk', 'likee']);
  });

  it('на пяти ссылках список пуст', () => {
    const p = pub({
      links: [link('tiktok'), link('instagram'), link('youtube'), link('vk'), link('likee')],
    });
    expect(missingPlatforms(p)).toEqual([]);
  });
});

describe('счётчики шапки', () => {
  it('ссылки считаются по пяти площадкам на каждую живую выкладку', () => {
    const items = [
      pub({ id: 'a', links: [link('tiktok'), link('vk')] }),
      pub({ id: 'b', links: [link('tiktok')] }),
      pub({ id: 'c', status: 'cancelled' }),
    ];
    expect(linksCollected(items)).toEqual({ done: 3, total: 10 });
  });

  it('закрытыми считаются и done, и закрытые менеджером', () => {
    const items = [
      pub({ id: 'a', status: 'done' }),
      pub({ id: 'b', status: 'closed_manually' }),
      pub({ id: 'c', status: 'partial' }),
    ];
    expect(closedCount(items)).toBe(2);
  });
});

describe('daysLeft / dueLabel', () => {
  const now = new Date(2026, 7, 27);

  it('просрочка — отрицательное число дней', () => {
    expect(daysLeft('2026-08-24T00:00:00Z', now)).toBe(-3);
    expect(dueLabel('2026-08-24T00:00:00Z', now)).toBe('−3 дня');
  });

  it('сегодня — ноль, а не «0 дней»', () => {
    expect(dueLabel('2026-08-27T00:00:00Z', now)).toBe('сегодня');
  });

  it('склонение хвоста по числу', () => {
    expect(dueLabel('2026-08-28T00:00:00Z', now)).toBe('1 день');
    expect(dueLabel('2026-08-29T00:00:00Z', now)).toBe('2 дня');
    expect(dueLabel('2026-09-01T00:00:00Z', now)).toBe('5 дней');
  });
});

describe('requiredUnchecked', () => {
  const items = [
    item({ id: 'c1', text: 'Артикул WB в описании' }),
    item({ id: 'c2', text: 'Геометка города', is_required: false }),
    item({ id: 'p-ig', text: 'Обложка 9:16', platform: 'instagram' }),
    item({ id: 'p-tt', text: 'Ссылка в закрепе', platform: 'tiktok', is_required: false }),
  ];

  it('обязательный пункт чужой площадки не блокирует сдачу', () => {
    const left = requiredUnchecked(items, ['tiktok'], new Set(['c1']));
    expect(left).toEqual([]);
  });

  it('обязательный пункт сдаваемой площадки блокирует', () => {
    const left = requiredUnchecked(items, ['instagram'], new Set(['c1']));
    expect(left.map((i) => i.id)).toEqual(['p-ig']);
  });

  it('необязательные пункты не блокируют никогда', () => {
    const left = requiredUnchecked(items, ['tiktok', 'instagram'], new Set(['c1', 'p-ig']));
    expect(left).toEqual([]);
  });

  it('неотмеченный общий пункт блокирует любую сдачу', () => {
    const left = requiredUnchecked(items, ['vk'], new Set());
    expect(left.map((i) => i.id)).toEqual(['c1']);
  });
});
