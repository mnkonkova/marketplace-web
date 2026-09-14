import {
  audienceOf,
  isValidMaterialUrl,
  materialsFor,
  sortMaterials,
  visibleTo,
} from '@entities/publication/lib/materials';
import { Material } from '@entities/publication/model/publication.types';

function material(over: Partial<Material> = {}): Material {
  return {
    id: 'm1',
    project_id: 'pr1',
    title: 'Бренд-гайд PetFlat',
    kind: 'doc',
    url: 'https://disk.example/brand.pdf',
    audience: 'creators',
    sort_order: 0,
    created_by: 'manager',
    created_at: '2026-08-04T10:00:00Z',
    ...over,
  };
}

const brief = material({ id: 'brief', audience: 'creators', title: 'Как снимать' });
const report = material({ id: 'report', audience: 'client', title: 'Отчёт за август' });

describe('audienceOf: аудитория материала', () => {
  it('client распознаётся явно', () => {
    expect(audienceOf(report)).toBe('client');
  });

  it('пустое поле — это creators, а не «всем»', () => {
    // Значение по умолчанию на бэке — creators. Трактовать пропуск как
    // клиентский материал нельзя: это показало бы заказчику обучение.
    expect(audienceOf(material({ audience: undefined as never }))).toBe('creators');
    expect(audienceOf(material({ audience: 'чужое' as never }))).toBe('creators');
  });
});

describe('visibleTo: что видит роль', () => {
  const all = [brief, report];

  it('заказчик не видит материалы для креаторов', () => {
    const seen = visibleTo(all, 'client');
    expect(seen.map((m) => m.id)).toEqual(['report']);
  });

  it('креатор видит свои и не видит клиентские', () => {
    const seen = visibleTo(all, 'creator');
    expect(seen.map((m) => m.id)).toEqual(['brief']);
  });

  it('менеджер видит обе аудитории', () => {
    expect(visibleTo(all, 'manager').map((m) => m.id)).toEqual(['brief', 'report']);
  });

  it('материал без аудитории заказчику не достаётся', () => {
    const sloppy = material({ id: 'sloppy', audience: undefined as never });
    expect(visibleTo([sloppy], 'client')).toEqual([]);
    expect(visibleTo([sloppy], 'creator').map((m) => m.id)).toEqual(['sloppy']);
  });
});

describe('materialsFor: раскладка менеджерского ответа', () => {
  it('делит один список на две группы без потерь', () => {
    const all = [brief, report, material({ id: 'guide' })];
    expect(materialsFor(all, 'creators').map((m) => m.id)).toEqual(['brief', 'guide']);
    expect(materialsFor(all, 'client').map((m) => m.id)).toEqual(['report']);
  });
});

describe('sortMaterials', () => {
  it('сортирует по sort_order, при равенстве — по времени добавления', () => {
    const a = material({ id: 'a', sort_order: 1, created_at: '2026-08-02T00:00:00Z' });
    const b = material({ id: 'b', sort_order: 0, created_at: '2026-08-03T00:00:00Z' });
    const c = material({ id: 'c', sort_order: 1, created_at: '2026-08-01T00:00:00Z' });
    expect(sortMaterials([a, b, c]).map((m) => m.id)).toEqual(['b', 'c', 'a']);
  });

  it('не мутирует исходный список', () => {
    const src = [material({ id: 'x', sort_order: 5 }), material({ id: 'y', sort_order: 1 })];
    sortMaterials(src);
    expect(src.map((m) => m.id)).toEqual(['x', 'y']);
  });
});

describe('isValidMaterialUrl', () => {
  it('http и https проходят', () => {
    expect(isValidMaterialUrl('https://disk.example/a.pdf')).toBeTrue();
    expect(isValidMaterialUrl(' http://disk.example/a.pdf ')).toBeTrue();
  });

  it('всё остальное бэк отклонит — не отправляем', () => {
    expect(isValidMaterialUrl('ftp://disk.example/a.pdf')).toBeFalse();
    expect(isValidMaterialUrl('javascript:alert(1)')).toBeFalse();
    expect(isValidMaterialUrl('/local/a.pdf')).toBeFalse();
    expect(isValidMaterialUrl('')).toBeFalse();
  });
});
