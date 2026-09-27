import {
  appliesTo,
  commonItems,
  itemsForPlatform,
  requiredUnchecked,
} from '@entities/publication/lib/checklist';
import { ChecklistItem } from '@entities/publication/model/publication.types';

/**
 * Чеклист сдачи: общие пункты и пункты площадок.
 *
 * Правило, которое легко потерять: обязательный пункт СВОЕЙ площадки
 * блокирует сдачу этой площадки. Пока такие пункты не рисовались в окне
 * сдачи, кнопка гасла с текстом «не отмечено обязательных пунктов: 1», а
 * отметить их было негде — единственное действие роли не выполнялось.
 * Тест держит обе стороны: что пункт блокирует и что он находится там,
 * где его показывают.
 */
describe('чеклист выкладки', () => {
  function item(over: Partial<ChecklistItem> = {}): ChecklistItem {
    return {
      id: over.id ?? 'i1',
      project_id: 'pr1',
      text: 'пункт',
      is_required: true,
      sort_order: 0,
      ...over,
    };
  }

  const common = item({ id: 'c1', text: 'Товар в кадре' });
  const tiktok = item({ id: 't1', text: 'Ссылка в закрепе', platform: 'tiktok' });
  const reels = item({ id: 'r1', text: 'Обложка 9:16', platform: 'instagram' });
  const optional = item({ id: 'o1', text: 'Хештеги', is_required: false });
  const all = [common, tiktok, reels, optional];

  it('общий пункт относится к любой площадке, пункт площадки — только к своей', () => {
    expect(appliesTo(common, 'tiktok')).toBe(true);
    expect(appliesTo(tiktok, 'tiktok')).toBe(true);
    expect(appliesTo(tiktok, 'instagram')).toBe(false);
  });

  it('разбор на общие и по площадкам не теряет пунктов', () => {
    expect(commonItems(all).map((i) => i.id)).toEqual(['c1', 'o1']);
    expect(itemsForPlatform(all, 'tiktok').map((i) => i.id)).toEqual(['t1']);
    expect(itemsForPlatform(all, 'instagram').map((i) => i.id)).toEqual(['r1']);
  });

  it('обязательный пункт своей площадки блокирует сдачу именно этой площадки', () => {
    const blocking = requiredUnchecked(all, ['tiktok'], new Set());
    expect(blocking.map((i) => i.id)).toEqual(['c1', 't1']);
    // Пункт Reels не мешает сдать TikTok: остальные площадки дошлют позже.
    expect(blocking.map((i) => i.id)).not.toContain('r1');
  });

  it('отмеченные пункты перестают блокировать, необязательные не блокируют вовсе', () => {
    expect(requiredUnchecked(all, ['tiktok'], new Set(['c1', 't1']))).toEqual([]);
    expect(requiredUnchecked([optional], ['tiktok'], new Set()).length).toBe(0);
  });

  it('каждый блокирующий пункт можно показать: он либо общий, либо своей площадки', () => {
    const submitting: ('tiktok' | 'instagram')[] = ['tiktok', 'instagram'];
    const shown = new Set([
      ...commonItems(all).map((i) => i.id),
      ...submitting.flatMap((p) => itemsForPlatform(all, p).map((i) => i.id)),
    ]);
    for (const b of requiredUnchecked(all, submitting, new Set())) {
      expect(shown.has(b.id))
        .withContext(`«${b.text}» блокирует сдачу, но не показан ни в одном списке`)
        .toBe(true);
    }
  });
});
