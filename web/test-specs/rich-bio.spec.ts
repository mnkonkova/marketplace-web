import { parseBio } from '@shared/ui/rich-bio/rich-bio.component';

describe('parseBio', () => {
  it('обычный текст — один абзац', () => {
    expect(parseBio('Продакшен полного цикла.')).toEqual([
      { kind: 'paragraph', lines: ['Продакшен полного цикла.'] },
    ]);
  });

  it('строки с ✅ / • / — собираются в один список без маркеров', () => {
    const blocks = parseBio('✅ Более 40 роликов\n• Своя команда\n— Съёмка в Москве');
    expect(blocks).toEqual([
      { kind: 'list', lines: ['Более 40 роликов', 'Своя команда', 'Съёмка в Москве'] },
    ]);
  });

  it('текст до и после списка остаётся абзацами', () => {
    const blocks = parseBio('Мы снимаем.\n\n✅ Первое\n✅ Второе\n\nПишите в Telegram.');
    expect(blocks.map((b) => b.kind)).toEqual(['paragraph', 'list', 'paragraph']);
    expect(blocks[1].lines).toEqual(['Первое', 'Второе']);
  });

  // Перенос строки внутри абзаца — это перенос, а не новый абзац: иначе
  // текст, набранный «лесенкой», рассыпается на десяток огрызков.
  it('соседние строки склеиваются в один абзац', () => {
    expect(parseBio('Первая строка\nвторая строка')).toEqual([
      { kind: 'paragraph', lines: ['Первая строка вторая строка'] },
    ]);
  });

  it('лишние пробелы схлопываются, переносы сохраняются', () => {
    const blocks = parseBio('Много     пробелов\n\n\n\nи пустых строк');
    expect(blocks).toEqual([
      { kind: 'paragraph', lines: ['Много пробелов'] },
      { kind: 'paragraph', lines: ['и пустых строк'] },
    ]);
  });

  it('пустой маркер без текста пропускается', () => {
    expect(parseBio('✅\n✅ Реальный пункт')).toEqual([
      { kind: 'list', lines: ['Реальный пункт'] },
    ]);
  });

  it('пустой bio — пустой результат', () => {
    expect(parseBio('')).toEqual([]);
    expect(parseBio('   \n  \n')).toEqual([]);
  });

  it('CRLF из Windows не ломает разбор', () => {
    expect(parseBio('Первый абзац\r\n\r\nВторой абзац')).toEqual([
      { kind: 'paragraph', lines: ['Первый абзац'] },
      { kind: 'paragraph', lines: ['Второй абзац'] },
    ]);
  });
});
