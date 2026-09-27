import { AuditParams } from '../model/admin-shell.types';

/**
 * Фильтры журнала живут в адресе — по той же причине, что и у проектов:
 * «покажи, кто трогал этот проект» пересылают ссылкой, а не пересказом.
 */
export interface AuditFilters {
  action: string;
  objectType: string;
  objectId: string;
  page: number;
  pageSize: number;
}

const PAGE_SIZES = [25, 50, 100];

const OBJECT_TYPES = ['user', 'project', 'terms_version', 'checklist_template'];

export const DEFAULT_AUDIT_FILTERS: AuditFilters = {
  action: '',
  objectType: '',
  objectId: '',
  page: 1,
  pageSize: 25,
};

/** Минимум того, что нужно от ActivatedRoute.queryParamMap. */
export interface QueryReader {
  get(name: string): string | null;
}

export function parseAuditFilters(params: QueryReader): AuditFilters {
  const d = DEFAULT_AUDIT_FILTERS;
  const size = Number(params.get('size'));
  const page = Number(params.get('page'));
  const objectType = params.get('object_type') ?? '';
  return {
    // Код действия не проверяем по списку: он приходит от бэка и растёт
    // там; незнакомый просто ничего не найдёт, а чистить его здесь
    // значило бы ронять фильтр на каждое новое действие.
    action: (params.get('action') ?? '').trim(),
    objectType: OBJECT_TYPES.includes(objectType) ? objectType : d.objectType,
    objectId: (params.get('object_id') ?? '').trim(),
    page: Number.isInteger(page) && page > 0 ? page : d.page,
    pageSize: PAGE_SIZES.includes(size) ? size : d.pageSize,
  };
}

export function auditFiltersToQuery(f: AuditFilters): Record<string, string | null> {
  const d = DEFAULT_AUDIT_FILTERS;
  return {
    action: f.action || null,
    object_type: f.objectType || null,
    object_id: f.objectId || null,
    page: f.page > 1 ? String(f.page) : null,
    size: f.pageSize === d.pageSize ? null : String(f.pageSize),
  };
}

export function auditFiltersToParams(f: AuditFilters): AuditParams {
  const p: AuditParams = {
    limit: f.pageSize,
    offset: (f.page - 1) * f.pageSize,
  };
  if (f.action) p.action = f.action;
  if (f.objectType) p.object_type = f.objectType;
  if (f.objectId) p.object_id = f.objectId;
  return p;
}
