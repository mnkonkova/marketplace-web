import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';

import { TelegramApi } from '@entities/telegram/api/telegram.api';
import { TelegramLinkStore } from '@entities/telegram/model/telegram-link.store';
import { TelegramStatus } from '@entities/telegram/model/telegram.types';

/**
 * Состояние привязки к ботам — один запрос на вкладку.
 *
 * Кнопка «Получать уведомления в Telegram» стоит в карточке проекта, а
 * карточек человек открывает много. Запрос на каждой — это один и тот
 * же ответ десять раз за минуту.
 *
 * И два состояния, которые нельзя путать: «не подключал» и
 * «заблокировал». Во втором случае кнопку надо показать снова — бота
 * блокируют и по ошибке, — но текст у неё другой.
 */
describe('TelegramLinkStore', () => {
  let api: jasmine.SpyObj<TelegramApi>;

  function setup(status: TelegramStatus | null, fail = false): TelegramLinkStore {
    TestBed.resetTestingModule();
    api = jasmine.createSpyObj<TelegramApi>('api', ['status', 'linkCode', 'unlink']);
    api.status.and.returnValue(fail ? throwError(() => new Error('boom')) : (of(status) as never));
    TestBed.configureTestingModule({ providers: [{ provide: TelegramApi, useValue: api }] });
    return TestBed.inject(TelegramLinkStore);
  }

  it('грузится один раз, сколько бы карточек ни спросило', () => {
    const store = setup({ links: [], available: ['creator'] });
    store.ensureLoaded();
    store.ensureLoaded();
    store.ensureLoaded();
    expect(api.status).toHaveBeenCalledTimes(1);
  });

  it('кнопка есть только у настроенного бота', () => {
    const store = setup({ links: [], available: ['creator'] });
    store.ensureLoaded();
    expect(store.available('creator')).toBeTrue();
    // Клиентский бот не настроен: кнопка, ведущая в t.me/?start=, хуже
    // отсутствующей.
    expect(store.available('client')).toBeFalse();
  });

  it('подключённый бот гасит кнопку, заблокированный — возвращает', () => {
    const store = setup({
      available: ['creator', 'client'],
      links: [
        {
          user_id: 'u1',
          bot: 'creator',
          tg_user_id: 1,
          tg_chat_id: 1,
          linked_at: '2026-09-01T10:00:00Z',
        },
        {
          user_id: 'u1',
          bot: 'client',
          tg_user_id: 1,
          tg_chat_id: 1,
          linked_at: '2026-09-01T10:00:00Z',
          blocked_at: '2026-09-20T10:00:00Z',
        },
      ],
    });
    store.ensureLoaded();
    expect(store.linked('creator')).toBeTrue();
    // Заблокированный живой привязкой не считается: человеку надо
    // предложить вернуть бота, а не молчать.
    expect(store.linked('client')).toBeFalse();
    expect(store.blocked('client')).toBeTrue();
    expect(store.blocked('creator')).toBeFalse();
  });

  it('до ответа сервера состояние — «ещё не знаем», а не «не подключён»', () => {
    const store = setup(null);
    // Ничего не спрашивали — и кнопке рано появляться: мигнуть ею и
    // убрать хуже, чем показать на полсекунды позже.
    expect(store.loaded()).toBeFalse();
  });

  it('отказ сервера не ломает экран: кнопки просто нет', () => {
    const store = setup(null, true);
    store.ensureLoaded();
    expect(store.loaded()).toBeTrue();
    expect(store.available('creator')).toBeFalse();
  });

  it('reload перечитывает: после привязки кнопка обязана погаснуть сама', () => {
    const store = setup({ links: [], available: ['creator'] });
    store.ensureLoaded();
    api.status.and.returnValue(
      of({
        available: ['creator'],
        links: [
          {
            user_id: 'u1',
            bot: 'creator',
            tg_user_id: 1,
            tg_chat_id: 1,
            linked_at: '2026-09-27T10:00:00Z',
          },
        ],
      }) as never,
    );
    store.reload();
    expect(api.status).toHaveBeenCalledTimes(2);
    expect(store.linked('creator')).toBeTrue();
  });
});
