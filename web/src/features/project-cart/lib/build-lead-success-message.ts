import { SpecialistLite } from '@entities/specialist/model/specialist.types';

export function buildLeadSuccessMessage(
  specialists: SpecialistLite[],
  clientContact: string,
): string {
  const count = specialists.length;
  const names = specialists.map((s) => s.display_name).join(', ');
  return `Заявка отправлена (${count}): ${names}. Бриф ушёл специалистам, ответят на ${clientContact}.`;
}
