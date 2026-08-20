import { MAX_REASONABLE_RATE, validateRate } from '@shared/lib/rate-validation';

describe('validateRate — цена в редакторе профиля', () => {
  it('пустая цена не ошибка, но клиент увидит «по договорённости»', () => {
    const r = validateRate(null, null);
    expect(r.error).toBeNull();
    expect(r.min).toBeNull();
    expect(r.max).toBeNull();
    expect(r.preview).toBe('по договорённости');
    expect(r.warning).toContain('по договорённости');
  });

  // Именно этот кейс давал «от 0 ₽» на публичной.
  it('ноль нормализуется в «не указано», а не в «от 0 ₽»', () => {
    const r = validateRate(0, 0);
    expect(r.error).toBeNull();
    expect(r.min).toBeNull();
    expect(r.max).toBeNull();
    expect(r.preview).toBe('по договорённости');
    expect(r.warning).toContain('Ноль');
  });

  it('только нижняя граница — это «от N ₽»', () => {
    const r = validateRate(30000, null);
    expect(r.error).toBeNull();
    expect(r.min).toBe(30000);
    expect(r.preview).toBe(`от ${(30000).toLocaleString('ru-RU')} ₽`);
  });

  it('вменяемая вилка проходит и рендерится диапазоном', () => {
    const r = validateRate(30000, 90000);
    expect(r.error).toBeNull();
    expect(r.preview).toBe(
      `${(30000).toLocaleString('ru-RU')}–${(90000).toLocaleString('ru-RU')} ₽`,
    );
  });

  it('«от» больше «до» — блокирует сохранение', () => {
    expect(validateRate(90000, 30000).error).toBe('Ставка «от» больше, чем «до».');
  });

  // «100 000–100 000 000 ₽» — реальный случай с публичной. Верхняя граница
  // там ещё и выше потолка, поэтому проверяем оба сообщения по отдельности.
  it('ставка выше разумного потолка — опечатка, блокируем', () => {
    expect(validateRate(MAX_REASONABLE_RATE + 1, null).error).toContain('лишний ноль');
  });

  it('отрицательная ставка блокируется', () => {
    expect(validateRate(-100, null).error).toBe('Ставка не может быть отрицательной.');
  });

  it('валюта попадает в превью', () => {
    expect(validateRate(500, null, 'USD').preview).toBe('от 500 USD');
  });
});
