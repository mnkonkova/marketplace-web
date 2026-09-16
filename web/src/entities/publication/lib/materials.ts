import { Material, MaterialAudience, MaterialKind } from '../model/publication.types';

// Материалы проекта живут в двух аудиториях, и это не косметика, а право
// доступа: бренд-гайд и обучение открываются креатору в момент добавления
// в проект, а заказчику не показываются вовсе. Бэк уже отдаёт каждой роли
// только своё, но менеджер видит обе аудитории в одном ответе — и вот там
// разделение делаем мы.

export const MATERIAL_KIND_LABEL: Record<MaterialKind, string> = {
  doc: 'Документ',
  video: 'Видео',
  link: 'Ссылка',
};

export const MATERIAL_AUDIENCE_LABEL: Record<MaterialAudience, string> = {
  creators: 'Материалы для креаторов',
  client: 'Материалы для заказчика',
};

export const MATERIAL_AUDIENCE_NOTE: Record<MaterialAudience, string> = {
  creators: 'Открываются креатору в момент добавления в проект. Клиент их не видит.',
  client: 'Видно заказчику в его кабинете. Креаторам эти файлы не показываются.',
};

// Аудитория материала. Пустое поле у бэка значит creators (значение по
// умолчанию), и трактовать его как «клиентский» нельзя: ошибка в эту
// сторону показывает заказчику внутреннюю кухню.
export function audienceOf(m: Material): MaterialAudience {
  return m.audience === 'client' ? 'client' : 'creators';
}

export function materialsFor(items: Material[], audience: MaterialAudience): Material[] {
  return items.filter((m) => audienceOf(m) === audience);
}

// Что из списка вправе увидеть роль. У клиента — только client-материалы;
// креатор и менеджер видят креаторские, менеджер вдобавок клиентские.
// Дублирует серверное правило намеренно: если менеджерский ответ попадёт
// в клиентский блок по ошибке разработчика, здесь это отсечётся.
export function visibleTo(items: Material[], role: 'client' | 'creator' | 'manager'): Material[] {
  if (role === 'client') return materialsFor(items, 'client');
  if (role === 'creator') return materialsFor(items, 'creators');
  return [...items];
}

// Порядок как у бэка: сначала sort_order, при равенстве — по времени
// добавления. Без второго ключа материалы одного порядка прыгают между
// перезагрузками.
export function sortMaterials(items: Material[]): Material[] {
  return [...items].sort(
    (a, b) => a.sort_order - b.sort_order || a.created_at.localeCompare(b.created_at),
  );
}
