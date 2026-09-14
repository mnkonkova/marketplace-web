import type { Publication } from '@entities/publication/model/publication.types';
import {
  isDisabledDay,
  isPastDay,
  isSelfAdded,
  isTooFarAhead,
  takenOn,
  ymdLocal,
} from '@entities/publication/lib/extra-publication';

/**
 * Своя выкладка сверх плана: то, что считается до запроса.
 *
 * Границы даты и занятый день сервер держит сам и отвечает человеческим
 * текстом. Здесь то же самое считается РАНЬШЕ — чтобы календарь не
 * показывал выбираемым день, на который потом прилетит отказ: такой
 * отказ человек относит к сбою, а не к своему расписанию.
 */
describe('своя выкладка сверх плана', () => {
  function pub(over: Partial<Publication> = {}): Publication {
    return {
      id: 'p1',
      project_id: 'pr1',
      creator_user_id: 'u1',
      due_date: '2026-09-20',
      status: 'planned',
      created_at: '2026-09-14T00:00:00Z',
      updated_at: '2026-09-14T00:00:00Z',
      links: [],
      overdue: false,
      views: 0,
      likes: 0,
      comments: 0,
      ...over,
    };
  }

  describe('ymdLocal', () => {
    /**
     * toISOString() переводит в UTC, и восточнее Гринвича выбранное «20
     * сентября» уезжает на 19-е: в календаре человек видит один день, а
     * заводится другой — молча.
     */
    it('дата берётся локальная, а не сдвинутая в UTC', () => {
      // Почти полночь по местному времени — в UTC это уже другой день
      // либо всё ещё предыдущий, смотря куда смещён пояс.
      expect(ymdLocal(new Date(2026, 8, 20, 23, 30))).toBe('2026-09-20');
      expect(ymdLocal(new Date(2026, 8, 20, 0, 15))).toBe('2026-09-20');
    });

    it('месяц и день дополняются нулём', () => {
      expect(ymdLocal(new Date(2026, 0, 5))).toBe('2026-01-05');
    });
  });

  describe('границы даты', () => {
    const today = new Date(2026, 8, 14, 13, 0);

    /** Сегодня — можно: ролик мог выйти сегодня утром. */
    it('сегодня выбрать можно, вчера — нет', () => {
      expect(isPastDay(new Date(2026, 8, 14, 0, 0), today)).toBeFalse();
      expect(isPastDay(new Date(2026, 8, 14, 23, 59), today)).toBeFalse();
      expect(isPastDay(new Date(2026, 8, 13, 23, 59), today)).toBeTrue();
    });

    it('будущее открыто', () => {
      expect(isDisabledDay(new Date(2026, 8, 20), today)).toBeFalse();
    });

    /** Дата дальше года — это опечатка в годе, а не план. */
    it('дальше года вперёд не даём: так вводят опечатку в годе', () => {
      expect(isTooFarAhead(new Date(2027, 8, 10), today)).toBeFalse();
      expect(isTooFarAhead(new Date(2036, 8, 14), today)).toBeTrue();
      expect(isDisabledDay(new Date(2036, 8, 14), today)).toBeTrue();
    });
  });

  describe('takenOn', () => {
    it('на занятый день выкладку не заводят', () => {
      const found = takenOn([pub({ due_date: '2026-09-20' })], '2026-09-20');
      expect(found?.id).toBe('p1');
    });

    /** Отменённую сняли с плана: день снова свободен. */
    it('отменённая выкладка день не занимает', () => {
      const items = [pub({ due_date: '2026-09-20', status: 'cancelled' })];
      expect(takenOn(items, '2026-09-20')).toBeNull();
    });

    it('время в дате сравнению не мешает', () => {
      const items = [pub({ due_date: '2026-09-20T00:00:00Z' })];
      expect(takenOn(items, '2026-09-20')).not.toBeNull();
    });

    it('свободный день так и остаётся свободным', () => {
      expect(takenOn([pub({ due_date: '2026-09-20' })], '2026-09-21')).toBeNull();
    });
  });

  describe('isSelfAdded', () => {
    /**
     * У плановых выкладок ключа нет ВОВСЕ, поэтому проверяется наличие
     * поля, а не значение: сравнение с false отметило бы плановую как
     * самодобавленную ровно наоборот.
     */
    it('плановая выкладка своей не считается', () => {
      expect(isSelfAdded(pub())).toBeFalse();
    });

    it('самодобавленная — считается', () => {
      expect(isSelfAdded(pub({ self_added: true }))).toBeTrue();
    });
  });
});
