import { DocAudience, DocKind } from '../model/document.types';

export const DOC_KIND_LABEL: Record<DocKind, string> = {
  contract: 'Договор',
  act: 'Акт',
  nda: 'NDA',
  other: 'Документ',
};

export const DOC_KINDS: readonly DocKind[] = ['contract', 'act', 'nda', 'other'] as const;

export const DOC_AUDIENCE_LABEL: Record<DocAudience, string> = {
  creators: 'креаторам',
  client: 'заказчику',
};
