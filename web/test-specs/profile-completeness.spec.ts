import { MeProfile } from '@entities/me/model/me.types';
import { PortfolioItem } from '@entities/specialist/model/specialist.types';
import {
  PROFILE_TAB_IDS,
  completenessChecks,
  completenessPercent,
  missingWeightByTab,
} from '@shared/lib/profile-completeness';

function emptyProfile(over: Partial<MeProfile> = {}): MeProfile {
  return {
    updated_at: '2026-01-01T00:00:00Z',
    user_id: 'u1',
    display_name: '',
    bio: '',
    currency: 'RUB',
    is_published: false,
    categories: [],
    skill_ids: [],
    is_freelance: false,
    moderation_status: 'pending_review',
    ...over,
  };
}

function work(id: string): PortfolioItem {
  return {
    id,
    kind: 'video',
    title: id,
    description: '',
    category_codes: [],
    sort_order: 0,
    created_at: '2026-01-01T00:00:00Z',
  };
}

describe('profile-completeness', () => {
  it('без профиля — пустой список и 0%', () => {
    expect(completenessChecks(null)).toEqual([]);
    expect(completenessPercent([])).toBe(0);
  });

  it('сумма весов всех пунктов = 100', () => {
    const total = completenessChecks(emptyProfile()).reduce((s, c) => s + c.weight, 0);
    expect(total).toBe(100);
  });

  it('пустой профиль — 0%, всё недостающее разложено по вкладкам', () => {
    const checks = completenessChecks(emptyProfile(), []);
    expect(completenessPercent(checks)).toBe(0);
    const missing = missingWeightByTab(checks);
    // 5 (имя) + 10 (аватар) + 15 (bio) + 5 (студия) + 5 (цена)
    expect(missing.basic).toBe(40);
    expect(missing.skills).toBe(10);
    expect(missing.portfolio).toBe(30);
    expect(missing.contacts).toBe(15);
    expect(missing.publish).toBe(5);
  });

  it('полностью заполненный профиль — 100% и ни одной точки на табах', () => {
    const checks = completenessChecks(
      emptyProfile({
        display_name: 'Аня',
        avatar_url: 'https://cdn/a.jpg',
        bio: 'о'.repeat(100),
        categories: ['editor'],
        is_freelance: true,
        rate_min: 30000,
        username: 'anya',
        social_links: { telegram: '@anya' },
        contact_email: 'a@b.c',
      }),
      [work('1'), work('2'), work('3')],
    );
    expect(completenessPercent(checks)).toBe(100);
    const missing = missingWeightByTab(checks);
    for (const tab of PROFILE_TAB_IDS) {
      expect(missing[tab]).withContext(tab).toBe(0);
    }
  });

  it('одна работа закрывает portfolio_1, но не portfolio_3', () => {
    const checks = completenessChecks(emptyProfile(), [work('1')]);
    expect(missingWeightByTab(checks).portfolio).toBe(15);
  });

  it('нулевая ставка не считается заполненной ценой', () => {
    const checks = completenessChecks(emptyProfile({ rate_min: 0, rate_max: 0 }));
    expect(checks.find((c) => c.id === 'rate')?.ok).toBeFalse();
  });

  it('каждый пункт привязан к существующей вкладке', () => {
    for (const c of completenessChecks(emptyProfile())) {
      expect(PROFILE_TAB_IDS).withContext(c.id).toContain(c.tab);
    }
  });
});
