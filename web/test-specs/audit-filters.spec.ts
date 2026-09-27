import {
  DEFAULT_AUDIT_FILTERS,
  auditFiltersToParams,
  auditFiltersToQuery,
  parseAuditFilters,
} from '@entities/admin/lib/audit-filters';
import { AUDIT_ACTION_LABEL, AUDIT_ACTION_OPTIONS } from '@entities/admin/lib/audit-labels';

/**
 * Журнал: фильтры и страница живут в адресе.
 *
 * Проверяем то, ради чего они туда попали: ссылку «вот что делали с этим
 * человеком» пересылают, и она открывается тем же срезом. Карточка
 * человека собирает такой адрес сама — если разбор разойдётся со сборкой,
 * кнопка «Вся история в журнале» приведёт не туда, и заметить это можно
 * будет только глазами.
 */

function params(q: Record<string, string>) {
  return { get: (n: string) => (n in q ? q[n] : null) };
}

describe('parseAuditFilters', () => {
  it('пустой адрес — значения по умолчанию', () => {
    expect(parseAuditFilters(params({}))).toEqual(DEFAULT_AUDIT_FILTERS);
  });

  it('срез по одной записи читается целиком — так ведёт карточка человека', () => {
    const f = parseAuditFilters(params({ object_type: 'user', object_id: 'u-1' }));
    expect(f.objectType).toBe('user');
    expect(f.objectId).toBe('u-1');
  });

  it('незнакомый тип объекта не доезжает до запроса', () => {
    expect(parseAuditFilters(params({ object_type: 'таблица' })).objectType).toBe('');
  });

  // Коды действий растут на бэке, и чистить их здесь значило бы ронять
  // фильтр на каждое новое действие.
  it('незнакомый код действия сохраняется как есть', () => {
    expect(parseAuditFilters(params({ action: 'user.new_thing' })).action).toBe('user.new_thing');
  });

  it('размер страницы — только из списка допустимых', () => {
    expect(parseAuditFilters(params({ size: '50' })).pageSize).toBe(50);
    expect(parseAuditFilters(params({ size: '100000' })).pageSize).toBe(25);
  });
});

describe('auditFiltersToQuery', () => {
  it('значения по умолчанию в адрес не пишутся', () => {
    const q = auditFiltersToQuery(DEFAULT_AUDIT_FILTERS);
    for (const [key, value] of Object.entries(q)) {
      expect(value).withContext(`${key} не должен попадать в адрес`).toBeNull();
    }
  });

  it('что записали в адрес, то из него и читается', () => {
    const f = {
      action: 'user.revoke_manager',
      objectType: 'user',
      objectId: 'u-7',
      page: 2,
      pageSize: 50,
    };
    const flat: Record<string, string> = {};
    for (const [k, v] of Object.entries(auditFiltersToQuery(f))) if (v !== null) flat[k] = v;
    expect(parseAuditFilters(params(flat))).toEqual(f);
  });
});

describe('auditFiltersToParams', () => {
  it('страница считается в limit/offset — бэк номеров страниц не знает', () => {
    const p = auditFiltersToParams({ ...DEFAULT_AUDIT_FILTERS, page: 3, pageSize: 50 });
    expect(p.limit).toBe(50);
    expect(p.offset).toBe(100);
  });

  it('пустые фильтры в запрос не попадают', () => {
    const p = auditFiltersToParams(DEFAULT_AUDIT_FILTERS);
    expect(p.action).toBeUndefined();
    expect(p.object_type).toBeUndefined();
    expect(p.object_id).toBeUndefined();
  });
});

describe('названия действий', () => {
  // Журнал читают, чтобы понять, кто что сделал; `user.revoke_manager`
  // этого не говорит. Список закрытый и совпадает с константами бэка.
  it('каждое действие названо по-русски и без кода', () => {
    for (const [code, label] of Object.entries(AUDIT_ACTION_LABEL)) {
      expect(label).withContext(code).not.toContain('.');
      expect(label.trim().length).withContext(code).toBeGreaterThan(3);
    }
  });

  it('в фильтре есть «любое действие» и все известные коды', () => {
    expect(AUDIT_ACTION_OPTIONS[0].value).toBe('');
    expect(AUDIT_ACTION_OPTIONS.length).toBe(Object.keys(AUDIT_ACTION_LABEL).length + 1);
  });
});
