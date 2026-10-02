// Документы — соответствуют DTO из marketplace-api/internal/publications/
// documents.go. Только ссылки: файлов у документа нет (решение владельца
// от 2 октября 2026).

export type DocKind = 'contract' | 'act' | 'nda' | 'other';

/** Кому документ: креаторам проекта или его заказчику. */
export type DocAudience = 'creators' | 'client';

export interface TemplateVersion {
  id: string;
  template_id: string;
  version: number;
  url: string;
  note?: string;
  published_at: string;
}

export interface DocumentTemplate {
  id: string;
  kind: DocKind;
  title: string;
  audience: DocAudience;
  created_at: string;
  // Есть — шаблон в архиве: из выбора у менеджера ушёл, не удалён.
  archived_at?: string;
  current?: TemplateVersion;
  // История версий, свежие сверху. Только в выдаче админу.
  versions?: TemplateVersion[];
}

/** Документ, выданный конкретному человеку. */
export interface UserDocument {
  id: string;
  recipient_user_id: string;
  recipient_name?: string;
  project_id: string;
  project_title?: string;
  audience: DocAudience;
  template_id?: string;
  // Номер версии шаблона, по которой выдан. Нет — своя ссылка менеджера.
  template_version?: number;
  kind: DocKind;
  title: string;
  url: string;
  note?: string;
  sent_by?: string;
  sent_by_name?: string;
  sent_at: string;
  opened_at?: string;
  // Есть — отозван: у адресата пропал, в истории выдачи остался.
  revoked_at?: string;
}

/** Строка «Моих документов»: выданное лично или договор из проекта. */
export interface MyDocument {
  id: string;
  // personal — выдан лично, отмечается открытым; project — договор из
  // материалов проекта, общий для состава.
  source: 'personal' | 'project';
  project_id: string;
  project_title: string;
  kind: DocKind;
  title: string;
  url: string;
  note?: string;
  sent_at: string;
  opened_at?: string;
}

export interface DeliverDocumentInput {
  audience: DocAudience;
  // Пусто — всему составу или заказчику проекта.
  recipient_ids?: string[];
  // Выдать действующую версию шаблона; без него нужны kind, title и url.
  template_id?: string;
  kind?: DocKind;
  title?: string;
  url?: string;
  note?: string;
}

export interface NewTemplateInput {
  kind: DocKind;
  title: string;
  audience: DocAudience;
  url: string;
  note?: string;
}
