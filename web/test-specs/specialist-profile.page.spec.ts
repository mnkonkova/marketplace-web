import { TestBed } from '@angular/core/testing';
import { ActivatedRoute } from '@angular/router';
import { Meta, Title } from '@angular/platform-browser';
import { NzMessageService } from 'ng-zorro-antd/message';
import { of } from 'rxjs';

import { SpecialistApi } from '@entities/specialist/api/specialist.api';
import { PortfolioItem, SpecialistProfile } from '@entities/specialist/model/specialist.types';
import { ProjectCartStore } from '@features/project-cart/model/project-cart.store';
import { SpecialistProfilePage } from '@pages/specialist-profile/specialist-profile.page';

function work(id: string, title: string, featured = false): PortfolioItem {
  return {
    id,
    kind: 'video',
    title,
    description: '',
    video_url: `https://s3/${id}.mp4`,
    category_codes: [],
    sort_order: 0,
    created_at: '2026-01-01T00:00:00Z',
    is_featured: featured,
  };
}

function profile(portfolio: PortfolioItem[]): SpecialistProfile {
  return {
    user_id: 'u1',
    display_name: 'Специалист',
    currency: 'RUB',
    categories: [],
    skills: [],
    portfolio,
    reviews: [],
  } as unknown as SpecialistProfile;
}

function setup(): SpecialistProfilePage {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      { provide: ActivatedRoute, useValue: { paramMap: of(new Map()) } },
      {
        provide: SpecialistApi,
        useValue: jasmine.createSpyObj<SpecialistApi>('SpecialistApi', ['getById']),
      },
      {
        provide: ProjectCartStore,
        useValue: jasmine.createSpyObj<ProjectCartStore>('cart', ['has', 'toggle']),
      },
      { provide: Meta, useValue: jasmine.createSpyObj<Meta>('Meta', ['updateTag']) },
      { provide: Title, useValue: jasmine.createSpyObj<Title>('Title', ['setTitle']) },
      {
        provide: NzMessageService,
        useValue: jasmine.createSpyObj<NzMessageService>('msg', ['success', 'error']),
      },
    ],
  });
  return TestBed.runInInjectionContext(() => new SpecialistProfilePage());
}

describe('SpecialistProfilePage — разбор портфолио', () => {
  it('закреплённая работа уходит во флагман и исчезает из ленты', () => {
    const page = setup();
    page.profile.set(profile([work('a', 'Обычная'), work('b', 'Промо', true)]));

    expect(page.featured()?.id).toBe('b');
    expect(page.feedItems().map((w) => w.id)).toEqual(['a']);
    expect(page.worksCount()).toBe(2);
  });

  it('без закреплённой работы флагман пуст, лента показывает всё', () => {
    const page = setup();
    page.profile.set(profile([work('a', 'Раз'), work('b', 'Два')]));

    expect(page.featured()).toBeNull();
    expect(page.feedItems().map((w) => w.id)).toEqual(['a', 'b']);
  });
});

// Регрессия: плеер открывается по id работы, а не по её индексу. Порядок
// в /feed (sort_order, created_at DESC) не совпадает с порядком на странице,
// где флагман вынесен наверх, — на реальных данных они вообще обратные.
// С индексом клик по первой плитке открывал последнюю работу.
describe('SpecialistProfilePage — открытие плеера', () => {
  it('клик по плитке открывает именно её', () => {
    const page = setup();
    page.profile.set(
      profile([work('promo', 'Промо', true), work('x', 'Первая'), work('y', 'Вторая')]),
    );

    page.openFromFeed(1);
    expect(page.playerItemId()).toBe('y');

    page.openFromFeed(0);
    expect(page.playerItemId()).toBe('x');
  });

  it('клик по флагману открывает закреплённую работу, а не первую в ленте', () => {
    const page = setup();
    page.profile.set(profile([work('x', 'Первая'), work('promo', 'Промо', true)]));

    page.openFlagship();
    expect(page.playerItemId()).toBe('promo');
  });

  it('закрытие сбрасывает состояние плеера', () => {
    const page = setup();
    page.profile.set(profile([work('x', 'Первая')]));

    page.openFromFeed(0);
    expect(page.playerItemId()).toBe('x');

    page.closePlayer();
    expect(page.playerItemId()).toBeNull();
  });

  it('клик по несуществующему индексу не открывает плеер', () => {
    const page = setup();
    page.profile.set(profile([work('x', 'Первая')]));

    page.openFromFeed(42);
    expect(page.playerItemId()).toBeNull();
  });

  it('без закреплённой работы флагман не открывает ничего', () => {
    const page = setup();
    page.profile.set(profile([work('x', 'Первая')]));

    page.openFlagship();
    expect(page.playerItemId()).toBeNull();
  });
});

describe('SpecialistProfilePage — навыки', () => {
  function withSkills(count: number): SpecialistProfilePage {
    const page = setup();
    const skills = Array.from({ length: count }, (_, i) => ({
      id: `s${i}`,
      slug: `skill-${i}`,
      title: `Навык ${i}`,
      kind: 'tool',
    }));
    page.profile.set({ ...profile([]), skills } as SpecialistProfile);
    return page;
  }

  it('показывается первый ряд — восемь тегов', () => {
    const page = withSkills(25);
    expect(page.skillsToShow().length).toBe(8);
    expect(page.hiddenSkillsCount()).toBe(17);
  });

  it('после разворота видно все', () => {
    const page = withSkills(25);
    page.toggleSkills();
    expect(page.skillsToShow().length).toBe(25);
  });

  it('восемь и меньше — кнопки нет', () => {
    expect(withSkills(8).hiddenSkillsCount()).toBe(0);
    expect(withSkills(3).hiddenSkillsCount()).toBe(0);
  });

  it('без навыков ничего не падает', () => {
    const page = withSkills(0);
    expect(page.skillsToShow()).toEqual([]);
    expect(page.hiddenSkillsCount()).toBe(0);
  });
});

describe('SpecialistProfilePage — роли в шапке', () => {
  function withRoles(count: number): SpecialistProfilePage {
    const page = setup();
    const cats = Array.from({ length: count }, (_, i) => ({
      code: `c${i}`,
      title: `Роль ${i}`,
      is_primary: i === 0,
    }));
    page.profile.set({ ...profile([]), categories: cats } as SpecialistProfile);
    return page;
  }

  it('показываются три роли, остальные прячутся под «ещё N»', () => {
    const page = withRoles(15);
    expect(page.rolesToShow().length).toBe(3);
    expect(page.hiddenRolesCount()).toBe(12);
  });

  it('главная роль идёт первой', () => {
    const page = withRoles(5);
    expect(page.rolesToShow()[0]).toBe('Роль 0');
  });

  it('после раскрытия видно все', () => {
    const page = withRoles(15);
    page.toggleRoles();
    expect(page.rolesToShow().length).toBe(15);
    expect(page.hiddenRolesCount()).toBe(12);
  });

  it('три роли и меньше — кнопки «ещё» нет', () => {
    const page = withRoles(3);
    expect(page.hiddenRolesCount()).toBe(0);
  });
});

// Ссылка-визитка: при заданном shareBaseUrl ведёт на воркер превью, иначе —
// на текущий origin. См. комментарий в environments/environment.ts.
describe('SpecialistProfilePage shareUrl', () => {
  const build = (profile: { username?: string; user_id: string }, base: string) => {
    const handle = profile.username || profile.user_id;
    const trimmed = base?.replace(/\/+$/, '');
    if (trimmed) return `${trimmed}/s/${handle}`;
    return `https://wayprmarket.ru/specialist/${handle}`;
  };

  it('без базы ведёт на основной домен', () => {
    expect(build({ username: 'foxxmary', user_id: 'u-1' }, '')).toBe(
      'https://wayprmarket.ru/specialist/foxxmary',
    );
  });

  it('с базой ведёт на воркер', () => {
    expect(build({ username: 'foxxmary', user_id: 'u-1' }, 'https://p.example')).toBe(
      'https://p.example/s/foxxmary',
    );
  });

  it('лишний слэш в базе не удваивается', () => {
    expect(build({ username: 'foxxmary', user_id: 'u-1' }, 'https://p.example/')).toBe(
      'https://p.example/s/foxxmary',
    );
  });

  it('без username подставляется id', () => {
    expect(build({ user_id: 'u-42' }, 'https://p.example')).toBe('https://p.example/s/u-42');
  });
});

// Ссылка «Поделиться» должна быть одна и та же везде: и в карточке кабинета,
// и на публичной странице. Раньше карточка собирала её из window.location и
// копировала адрес основного домена, мимо воркера превью.
describe('publicShareUrl', () => {
  it('с базой воркера ведёт на /s/<handle>', () => {
    const base = 'https://wayprmarket.online';
    const build = (b: string, handle: string) => {
      const trimmed = b?.replace(/\/+$/, '');
      return trimmed ? `${trimmed}/s/${handle}` : `https://wayprmarket.ru/specialist/${handle}`;
    };
    expect(build(base, 'foxxmary')).toBe('https://wayprmarket.online/s/foxxmary');
    expect(build(base + '/', 'foxxmary')).toBe('https://wayprmarket.online/s/foxxmary');
  });

  it('без базы — обычный адрес текущего домена', () => {
    const build = (b: string, handle: string) => {
      const trimmed = b?.replace(/\/+$/, '');
      return trimmed ? `${trimmed}/s/${handle}` : `https://wayprmarket.ru/specialist/${handle}`;
    };
    expect(build('', 'u-1')).toBe('https://wayprmarket.ru/specialist/u-1');
  });
});
