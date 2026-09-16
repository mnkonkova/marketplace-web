import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';

import { NzMessageService } from 'ng-zorro-antd/message';
import { NzModalService } from 'ng-zorro-antd/modal';

import { PublicationApi } from '@entities/publication/api/publication.api';
import { withScheme } from '@shared/lib/url';
import { ProjectMaterialsComponent } from '@widgets/project-materials/project-materials.component';
import {
  audienceOf,
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

describe('withScheme', () => {
  it('адрес из строки браузера принимается как есть — схему дописываем', () => {
    expect(withScheme('vk.com/wall-1_2')).toBe('https://vk.com/wall-1_2');
    expect(withScheme(' disk.example/a.pdf ')).toBe('https://disk.example/a.pdf');
  });

  it('уже со схемой — не трогаем', () => {
    expect(withScheme('http://disk.example/a.pdf')).toBe('http://disk.example/a.pdf');
    expect(withScheme('https://disk.example/a.pdf')).toBe('https://disk.example/a.pdf');
  });

  // Дописывание схемы не должно превратить «что угодно» в ссылку: адрес,
  // открывающий не страницу, а код, отсюда обязан уходить отказом.
  it('не ссылка — остаётся не ссылкой', () => {
    expect(withScheme('ftp://disk.example/a.pdf')).toBeNull();
    expect(withScheme('javascript:alert(1)')).toBeNull();
    expect(withScheme('data:text/html,<script>alert(1)</script>')).toBeNull();
    expect(withScheme('/local/a.pdf')).toBeNull();
    expect(withScheme('просто текст')).toBeNull();
    expect(withScheme('vkcom')).toBeNull();
    expect(withScheme('')).toBeNull();
  });

  // Самое вредное, что умеет дописывание схемы: показать один хост, а
  // открыть другой. В UTM-метках ссылка рисуется текстом самого адреса —
  // менеджер читает «vk.com» и кликает на evil.com. В материалах текстом
  // служит название, и настоящего хоста не видно вовсе.
  it('userinfo — отказ: текст ссылки врёт про хост', () => {
    expect(withScheme('vk.com@evil.com/path')).toBeNull();
    expect(withScheme('https://vk.com@evil.com/path')).toBeNull();
    expect(withScheme('user:pass@evil.com/x')).toBeNull();
    // mailto: попадает сюда же: «//» в нём нет, схему допишут, и
    // «mailto:a» станет логином при хосте b.com.
    expect(withScheme('mailto:a@b.com')).toBeNull();
  });

  // «//evil.com» выглядит как путь внутри нашего же сайта. Дописать ему
  // схему — значит превратить внутренний на вид адрес в чужой хост.
  it('начало со слэша — отказ, это не адрес узла', () => {
    expect(withScheme('//evil.com')).toBeNull();
    expect(withScheme('///evil.com')).toBeNull();
    expect(withScheme('\\\\evil.com')).toBeNull();
    expect(withScheme('/\\evil.com')).toBeNull();
  });

  // Точка в имени узла нужна не сама по себе, а чтобы отличить адрес от
  // опечатки. Одна точка адресом не делает.
  it('имя узла из пустых меток — отказ', () => {
    expect(withScheme('.')).toBeNull();
    expect(withScheme('..')).toBeNull();
    expect(withScheme('.a')).toBeNull();
    expect(withScheme('a.')).toBeNull();
  });

  // Пробел внутри — обычное дело для ссылки на файл и для значения
  // метки. Раньше такой адрес сохранялся; запрет на пробел сделал бы
  // правку, задуманную как послабление, строже прежнего.
  it('пробел внутри — это ссылка, а не мусор', () => {
    expect(withScheme('https://disk.example/бриф на май.pdf')).toBe(
      'https://disk.example/бриф на май.pdf',
    );
    expect(withScheme('vk.com/?utm_campaign=Тест два')).toBe(
      'https://vk.com/?utm_campaign=Тест два',
    );
    // А пробел в имени узла ссылкой не становится. Случай не
    // теоретический: Chrome такой адрес принимает, подставляя
    // «vk.com%20evil.com», и без своей проверки имени узла мы бы в
    // браузере вели себя не так, как на прогоне в ноде.
    expect(withScheme('две точки.ру рядом')).toBeNull();
    expect(withScheme('vk.com evil.com/path')).toBeNull();
  });

  // Возвращается введённое, а не нормализованный URL: строка и хранится,
  // и показывается менеджеру текстом ссылки. Показать вместо «пример.рф»
  // punycode — значит не дать человеку узнать собственную метку.
  it('возвращает набранное, а не punycode', () => {
    expect(withScheme('пример.рф/?utm_source=vk')).toBe('https://пример.рф/?utm_source=vk');
    expect(withScheme('HTTP://Disk.Example/A.pdf')).toBe('HTTP://Disk.Example/A.pdf');
  });

  // Литерал адреса набирают намеренно, опечаткой он не бывает. IPv4
  // здесь проходил всегда — отклонять IPv6 значило бы запрещать одно и
  // то же в двух записях.
  it('литерал адреса — ссылка, в обеих записях', () => {
    expect(withScheme('http://[::1]/')).toBe('http://[::1]/');
    expect(withScheme('1.2.3.4/x')).toBe('https://1.2.3.4/x');
  });
});

/**
 * Подсказка в поле ссылки — это пример, а не украшение: человек набирает
 * то, что в ней показано. Пока там стояло «https://…», подсказка спорила
 * с самой правкой — весь её смысл в том, что схему писать не обязательно,
 * а поле просило ровно схему и ничего больше.
 *
 * Проверяем два свойства сразу: пример без схемы (иначе подсказка снова
 * просит лишнее) и пример, который форма примет (иначе она учит вводить
 * то, на что сама же ответит отказом).
 */
describe('ProjectMaterialsComponent: подсказка в поле ссылки', () => {
  function urlPlaceholder(): string {
    TestBed.configureTestingModule({
      imports: [ProjectMaterialsComponent],
      providers: [
        { provide: PublicationApi, useValue: { managerMaterials: () => of({ items: [] }) } },
        { provide: NzModalService, useValue: {} },
        { provide: NzMessageService, useValue: {} },
      ],
    });
    const f = TestBed.createComponent(ProjectMaterialsComponent);
    f.componentRef.setInput('projectId', 'pr1');
    f.componentRef.setInput('role', 'manager');
    f.detectChanges();
    f.componentInstance.openAdd();
    f.detectChanges();
    const input: HTMLInputElement = f.nativeElement.querySelector('input[name="url"]');
    expect(input).withContext('поле ссылки не отрисовалось').toBeTruthy();
    return input.placeholder;
  }

  it('показывает пример без схемы, который форма принимает', () => {
    const placeholder = urlPlaceholder();
    expect(placeholder).not.toMatch(/^https?:\/\//i);
    expect(withScheme(placeholder)).not.toBeNull();
  });
});
