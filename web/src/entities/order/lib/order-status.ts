import type { CandidateStatus, Order } from '../model/order.types';

// Как называется состояние человека в очереди.
//
// Словарь один на всех: заказчик в воронке и менеджер на проекте смотрят
// на одно и то же состояние, и называть его по-разному значит заставлять
// их сверять термины в переписке. «Не ответил» вместо «истекло» —
// намеренно: для того, кто читает, важен не механизм, а что срок вышел.
export const CANDIDATE_STATUS_LABEL: Record<CandidateStatus, string> = {
  reserve: 'В резерве',
  invited: 'Ждём ответа',
  // «Откликнулся» — это не «согласился»: человек прислал работу, а
  // берёт его в проект менеджер. Разница существенная: из двадцати
  // откликнувшихся в состав попадут двое.
  responded: 'Откликнулся',
  accepted: 'Взял заявку',
  declined: 'Отказался',
  expired: 'Не ответил',
};

/** Тон строки: цвет здесь — состояние, а не украшение. */
export function candidateTone(status: CandidateStatus): 'ok' | 'no' | 'wait' | '' {
  if (status === 'accepted') return 'ok';
  if (status === 'declined' || status === 'expired') return 'no';
  if (status === 'invited' || status === 'responded') return 'wait';
  return '';
}

/**
 * Свободные места: сколько согласий ещё нужно, за вычетом тех, кто уже
 * думает над приглашением.
 *
 * Формула та же, что на сервере (needed − accepted − invited). Если
 * посчитать иначе, интерфейс предложит позвать человека в занятое место
 * и получит отказ — а выглядеть это будет как сломанная кнопка.
 */
export function freeSlots(order: Order): number {
  const waiting = order.candidates.filter((c) => c.status === 'invited').length;
  return Math.max(0, order.needed - order.accepted - waiting);
}
