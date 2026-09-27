// Привязка к телеграм-ботам. DTO из marketplace-api/internal/telegram.

// Ботов два: креаторский (исполнителю) и клиентский (заказчику).
// Менеджерского нет и не будет — всё, что адресовано менеджеру, уходит
// в общий чат менеджеров.
export type TelegramBot = 'creator' | 'client';

export interface TelegramLink {
  user_id: string;
  bot: TelegramBot;
  tg_user_id: number;
  tg_chat_id: number;
  tg_username?: string;
  linked_at: string;
  // Человек заблокировал бота. Строка остаётся: «заблокировал» и
  // «никогда не подключал» — разные ответы на вопрос «почему не
  // приходит».
  blocked_at?: string;
}

export interface TelegramStatus {
  links: TelegramLink[];
  // Какие боты вообще настроены. Кнопку рисуем только по ним: кнопка,
  // ведущая в t.me/?start=, хуже отсутствующей.
  available: TelegramBot[];
}

export interface TelegramLinkStart {
  bot: TelegramBot;
  url: string;
  expires_at: string;
}
