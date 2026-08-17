import { PortfolioItem } from '@entities/specialist/model/specialist.types';
import {
  aspectLabel,
  hoverPreview,
  orientationOf,
  parseAspectRatio,
  posterSrc,
} from '@shared/lib/portfolio-media';

function item(overrides: Partial<PortfolioItem> = {}): PortfolioItem {
  return {
    id: 'i1',
    kind: 'video',
    title: 'Работа',
    description: '',
    category_codes: [],
    sort_order: 0,
    created_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

describe('parseAspectRatio', () => {
  it('«W:H» превращается в число', () => {
    expect(parseAspectRatio('16:9')).toBeCloseTo(16 / 9, 5);
    expect(parseAspectRatio('9:16')).toBeCloseTo(9 / 16, 5);
  });

  it('пустое и мусорное значение → null (формат неизвестен)', () => {
    expect(parseAspectRatio(undefined)).toBeNull();
    expect(parseAspectRatio('')).toBeNull();
    expect(parseAspectRatio('16/9')).toBeNull();
    expect(parseAspectRatio('0:16')).toBeNull();
    expect(parseAspectRatio('abc:def')).toBeNull();
  });
});

describe('orientationOf', () => {
  it('различает вертикаль, горизонталь и квадрат', () => {
    expect(orientationOf(9 / 16)).toBe('vertical');
    expect(orientationOf(16 / 9)).toBe('horizontal');
    expect(orientationOf(1)).toBe('square');
  });

  it('почти-квадрат остаётся квадратом (кроп на пару пикселей)', () => {
    expect(orientationOf(1.05)).toBe('square');
    expect(orientationOf(0.95)).toBe('square');
  });

  // Вертикаль по умолчанию: в портфолио её большинство, и широкая плитка
  // под вертикальный кадр выглядит хуже, чем наоборот.
  it('неизвестный формат считается вертикальным', () => {
    expect(orientationOf(null)).toBe('vertical');
  });
});

describe('aspectLabel', () => {
  it('подписывает ближайший стандартный формат', () => {
    expect(aspectLabel(9 / 16)).toBe('9:16');
    expect(aspectLabel(16 / 9)).toBe('16:9');
    expect(aspectLabel(1)).toBe('1:1');
    expect(aspectLabel(2.39)).toBe('2.39:1');
  });

  it('без формата подписи нет', () => {
    expect(aspectLabel(null)).toBe('');
  });
});

describe('posterSrc', () => {
  it('берёт thumbnail_url', () => {
    expect(posterSrc(item({ thumbnail_url: 'https://s3/t.jpg' }))).toBe('https://s3/t.jpg');
  });

  it('для фото-сета без thumbnail фолбэчит на первый кадр', () => {
    const photoset = item({
      kind: 'image',
      images: [
        { id: 'a', image_url: 'https://s3/1.jpg', sort_order: 0, created_at: '' },
        { id: 'b', image_url: 'https://s3/2.jpg', sort_order: 1, created_at: '' },
      ],
    });
    expect(posterSrc(photoset)).toBe('https://s3/1.jpg');
  });

  it('нечего показать → пустая строка (плитка сама решит, что рисовать)', () => {
    expect(posterSrc(item())).toBe('');
  });
});

describe('hoverPreview', () => {
  it('animated webp приоритетнее видео — играет мимо autoplay-политик', () => {
    const p = hoverPreview(
      item({
        animated_thumb_url: 'https://s3/a.webp',
        preview_url: 'https://s3/p.mp4',
        preview_status: 'ready',
        video_url: 'https://s3/full.mp4',
      }),
    );
    expect(p).toEqual({ kind: 'img', src: 'https://s3/a.webp' });
  });

  it('готовое 480p-превью предпочтительнее оригинала', () => {
    const p = hoverPreview(
      item({
        preview_url: 'https://s3/p.mp4',
        preview_status: 'ready',
        video_url: 'https://s3/full.mp4',
      }),
    );
    expect(p).toEqual({ kind: 'video', src: 'https://s3/p.mp4' });
  });

  it('превью ещё не готово → оригинал', () => {
    const p = hoverPreview(
      item({
        preview_url: 'https://s3/p.mp4',
        preview_status: 'processing',
        video_url: 'https://s3/full.mp4',
      }),
    );
    expect(p).toEqual({ kind: 'video', src: 'https://s3/full.mp4' });
  });

  it('нет медиа → null', () => {
    expect(hoverPreview(item({ kind: 'external', external_url: 'https://ya.ru' }))).toBeNull();
  });
});
