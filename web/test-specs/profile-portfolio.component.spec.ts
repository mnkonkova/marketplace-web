import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NzMessageService } from 'ng-zorro-antd/message';
import { NzModalService } from 'ng-zorro-antd/modal';
import { of, throwError } from 'rxjs';

import { MeRepository } from '@entities/me/repository/me.repository';
import { PortfolioItem } from '@entities/specialist/model/specialist.types';
import { ProfilePortfolioComponent } from '@features/profile-portfolio/profile-portfolio.component';

function work(id: string, over: Partial<PortfolioItem> = {}): PortfolioItem {
  return {
    id,
    kind: 'video',
    title: id,
    description: '',
    video_url: `https://s3/${id}.mp4`,
    category_codes: [],
    sort_order: 0,
    created_at: '2026-01-01T00:00:00Z',
    is_featured: false,
    ...over,
  };
}

interface Ctx {
  fixture: ComponentFixture<ProfilePortfolioComponent>;
  cmp: ProfilePortfolioComponent;
  meRepo: jasmine.SpyObj<MeRepository>;
}

function setup(items: PortfolioItem[]): Ctx {
  TestBed.resetTestingModule();
  const meRepo = jasmine.createSpyObj<MeRepository>('MeRepository', [
    'setPortfolioFeatured',
    'deletePortfolio',
    'updatePortfolioMeta',
    'updatePortfolioCategories',
  ]);
  TestBed.configureTestingModule({
    providers: [
      { provide: MeRepository, useValue: meRepo },
      {
        provide: NzMessageService,
        useValue: jasmine.createSpyObj<NzMessageService>('msg', [
          'success',
          'error',
          'warning',
          'info',
        ]),
      },
      {
        provide: NzModalService,
        useValue: jasmine.createSpyObj<NzModalService>('modal', ['create']),
      },
    ],
  });
  // Шаблон не нужен: проверяем логику промо и разбор формата.
  TestBed.overrideComponent(ProfilePortfolioComponent, { set: { template: '' } });
  const fixture = TestBed.createComponent(ProfilePortfolioComponent);
  fixture.componentRef.setInput('items', items);
  return { fixture, cmp: fixture.componentInstance, meRepo };
}

describe('ProfilePortfolioComponent — промо-работа', () => {
  it('выбор промо снимает флаг с предыдущей (radio-логика)', () => {
    const { cmp, meRepo } = setup([work('a', { is_featured: true }), work('b')]);
    meRepo.setPortfolioFeatured.and.returnValue(of(work('b', { is_featured: true })));

    let emitted: PortfolioItem[] = [];
    cmp.itemsChange.subscribe((v) => (emitted = v));
    cmp.toggleFeatured(work('b'));

    expect(meRepo.setPortfolioFeatured).toHaveBeenCalledWith('b', true);
    expect(emitted.find((i) => i.id === 'a')?.is_featured).toBeFalse();
    expect(emitted.find((i) => i.id === 'b')?.is_featured).toBeTrue();
  });

  it('повторный клик по промо снимает закрепление — «нет промо» допустимо', () => {
    const featured = work('a', { is_featured: true });
    const { cmp, meRepo } = setup([featured, work('b')]);
    meRepo.setPortfolioFeatured.and.returnValue(of(work('a', { is_featured: false })));

    let emitted: PortfolioItem[] = [];
    cmp.itemsChange.subscribe((v) => (emitted = v));
    cmp.toggleFeatured(featured);

    expect(meRepo.setPortfolioFeatured).toHaveBeenCalledWith('a', false);
    expect(emitted.every((i) => !i.is_featured)).toBeTrue();
  });

  it('ошибка запроса не меняет список', () => {
    const { cmp, meRepo } = setup([work('a')]);
    meRepo.setPortfolioFeatured.and.returnValue(throwError(() => ({ error: null })));

    const spy = jasmine.createSpy('itemsChange');
    cmp.itemsChange.subscribe(spy);
    cmp.toggleFeatured(work('a'));

    expect(spy).not.toHaveBeenCalled();
    expect(cmp.featuredBusyId()).toBeNull();
  });
});

describe('ProfilePortfolioComponent — формат из файла', () => {
  it('бейдж строится по aspect с бэка, вручную формат не задаётся', () => {
    const { cmp } = setup([]);
    expect(cmp.formatBadge(work('a', { aspect: '16:9' }))).toBe('16:9 · горизонт');
    expect(cmp.formatBadge(work('b', { aspect: '9:16' }))).toBe('9:16 · вертикаль');
    expect(cmp.formatBadge(work('c', { aspect: '1:1' }))).toBe('1:1 · квадрат');
  });

  it('без aspect формат неизвестен, пока клиент не измерил кадр', () => {
    const { cmp } = setup([]);
    const item = work('a');
    expect(cmp.formatBadge(item)).toBe('');
    expect(cmp.orientation(item)).toBe('unknown');

    cmp.onMeasured(item, 16 / 9);
    expect(cmp.orientation(item)).toBe('horizontal');
    expect(cmp.formatBadge(item)).toBe('16:9 · горизонт');
  });
});

describe('ProfilePortfolioComponent — шоурил', () => {
  it('горизонтальная промо-работа считается шоурилом-баннером', () => {
    const { cmp } = setup([work('a', { is_featured: true, aspect: '16:9' })]);
    expect(cmp.showreel()?.id).toBe('a');
  });

  it('вертикальное промо шоурилом не считается — флагман строится из него', () => {
    const { cmp } = setup([work('a', { is_featured: true, aspect: '9:16' })]);
    expect(cmp.featured()?.id).toBe('a');
    expect(cmp.showreel()).toBeNull();
  });

  it('без промо шоурила нет', () => {
    const { cmp } = setup([work('a'), work('b')]);
    expect(cmp.featured()).toBeNull();
    expect(cmp.showreel()).toBeNull();
  });
});
