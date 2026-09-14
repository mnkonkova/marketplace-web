import { ChecklistItem, Platform } from '../model/publication.types';

// Правила чеклиста повторяют assertChecklist из repo.go. Это не подмена
// серверной проверки (её всё равно нельзя обойти запросом), а способ не
// отправлять заведомо отказной запрос: креатор видит, чего не хватает, до
// нажатия, а не в тексте 422.

// Пункт относится к площадке: общий (platform не задан) — ко всем.
export function appliesTo(item: ChecklistItem, platform: Platform): boolean {
  return !item.platform || item.platform === platform;
}

export function commonItems(items: ChecklistItem[]): ChecklistItem[] {
  return items.filter((i) => !i.platform);
}

export function itemsForPlatform(items: ChecklistItem[], platform: Platform): ChecklistItem[] {
  return items.filter((i) => i.platform === platform);
}

// Обязательные пункты, которые мешают сдать именно этот набор площадок.
// Пункт чужой площадки не требуется: остальные площадки можно дослать позже.
export function requiredUnchecked(
  items: ChecklistItem[],
  submitting: Platform[],
  checkedIds: ReadonlySet<string>,
): ChecklistItem[] {
  const platforms = new Set(submitting);
  return items.filter((i) => {
    if (!i.is_required) return false;
    if (i.platform && !platforms.has(i.platform)) return false;
    return !checkedIds.has(i.id);
  });
}
