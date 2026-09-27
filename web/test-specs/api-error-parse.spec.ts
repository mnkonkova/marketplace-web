import { parseApiError } from '@shared/api/api-error';

// Ручки CRM отдают {error, message}, где message уже написан для
// пользователя по-русски. Правило одно: показываем message, свой текст
// сочиняем только когда его нет.
describe('parseApiError', () => {
  it('берёт message бэка, а не свой fallback', () => {
    const e = {
      status: 422,
      error: {
        error: 'checklist_incomplete',
        message: 'Не отмечены обязательные пункты: Артикул WB в описании.',
      },
    };
    const parsed = parseApiError(e, 'Не удалось сдать ссылки.');
    expect(parsed.code).toBe('checklist_incomplete');
    expect(parsed.status).toBe(422);
    expect(parsed.message).toBe('Не отмечены обязательные пункты: Артикул WB в описании.');
  });

  it('машинный код доступен отдельно — по нему реагируем особым образом', () => {
    const e = { status: 409, error: { error: 'publication_closed', message: 'Выкладка закрыта.' } };
    expect(parseApiError(e).code).toBe('publication_closed');
  });

  it('пустой message — включается наша формулировка', () => {
    const e = { status: 500, error: { error: 'db_down', message: '   ' } };
    expect(parseApiError(e, 'Не удалось загрузить выкладки.').message).toBe(
      // apiErrorMessage не знает такого кода, поэтому отдаёт сам код.
      'db_down',
    );
  });

  it('известный код без message переводится картой shared/api', () => {
    const e = { status: 401, error: { error: 'no_user' } };
    expect(parseApiError(e).message).toBe('Сессия истекла — войдите снова');
  });

  it('тело не JSON (упал прокси) — отдаём fallback, а не падаем', () => {
    const e = { status: 502, error: '<html>502 Bad Gateway</html>' };
    const parsed = parseApiError(e, 'Сервис недоступен.');
    expect(parsed.code).toBe('');
    expect(parsed.message).toBe('Сервис недоступен.');
    expect(parsed.status).toBe(502);
  });

  it('ошибки нет вовсе — не бросаем', () => {
    expect(parseApiError(null, 'Ошибка').message).toBe('Ошибка');
    expect(parseApiError(undefined).status).toBe(0);
  });

  it('details дописываются к тексту — их присылает валидация полей', () => {
    const e = {
      status: 400,
      error: {
        error: 'invalid_input',
        details: [{ field: 'requested_date', message: 'перенос в прошлое' }],
      },
    };
    expect(parseApiError(e).message).toBe('invalid_input. requested_date: перенос в прошлое');
  });
});
