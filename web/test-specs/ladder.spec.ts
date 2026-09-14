import {
  LADDER_STEP,
  LadderVideo,
  countLine,
  hitLine,
  hitVideo,
  isMature,
  ladderState,
  median,
  shortViews,
  stepPlan,
  stepShareText,
  typicalVideo,
} from '@entities/billing/lib/ladder';

// «Сегодня» фиксировано: зрелость ролика считается от текущей даты, и
// тест на «старше двух недель» иначе зависел бы от дня прогона.
const NOW = new Date(2026, 8, 30);

/** Ролик, вышедший `days` дней назад. */
function video(days: number, views: number, id = `v${days}-${views}`): LadderVideo {
  const d = new Date(NOW.getTime() - days * 86_400_000);
  return { id, views, published_at: d.toISOString() };
}

function many(count: number, views: number, days = 30): LadderVideo[] {
  return Array.from({ length: count }, (_, i) => video(days + i, views, `m${i}`));
}

describe('зрелость ролика', () => {
  it('две недели — граница: ровно на ней ролик уже зрелый', () => {
    expect(isMature(video(14, 1000), NOW)).toBeTrue();
    expect(isMature(video(13, 1000), NOW)).toBeFalse();
  });

  it('невышедший ролик не зрелый ни при каком возрасте', () => {
    expect(isMature({ id: 'x', views: 0 }, NOW)).toBeFalse();
  });
});

describe('медиана', () => {
  it('нечётное число значений — середина', () => {
    expect(median([10, 1, 5])).toBe(5);
  });

  it('чётное — среднее двух середин', () => {
    expect(median([10, 20, 30, 40])).toBe(25);
  });

  it('один виральный ролик медиану не сдвигает', () => {
    // Ради этого медиана и взята вместо среднего: со средним «обычный
    // ролик» становится недостижимым, и весь дальнейший план врёт.
    expect(median([4000, 4000, 5000, 4000, 3_000_000])).toBe(4000);
  });

  it('считать нечего — null, а не ноль', () => {
    expect(median([])).toBeNull();
  });
});

// typicalVideo/hitVideo считают медиану на месте. Готовый «типичный
// ролик» сейчас приходит с сервера — своей копии лесенки «свои → проект →
// значение по умолчанию» в браузере нет, — но сама медиана осталась
// проверяемой: правило от этого не изменилось.
describe('типичный ролик', () => {
  it('десять своих зрелых — считаем по себе', () => {
    const t = typicalVideo(many(10, 4000), null, NOW);
    expect(t).toEqual({ views: 4000, source: 'creator', sample: 10 });
  });

  it('своих меньше десяти — берём обезличенную медиану проекта', () => {
    const t = typicalVideo(many(3, 4000), 7500, NOW);
    expect(t?.views).toBe(7500);
    expect(t?.source).toBe('project');
  });

  it('молодые ролики в медиану не попадают', () => {
    // Девять зрелых и один вчерашний — своих всё ещё меньше десяти.
    const own = [...many(9, 4000), video(1, 10)];
    expect(typicalVideo(own, 7500, NOW)?.source).toBe('project');
  });

  it('нет ни своих, ни проектной — считать не на чем, и это так и сказано', () => {
    // Подставить сюда придуманное число значит построить на нём и план
    // «сколько роликов до ступени», и прогноз.
    expect(typicalVideo(many(3, 4000), null, NOW)).toBeNull();
    expect(typicalVideo([], 0, NOW)).toBeNull();
  });

  it('медиана считается по последним двадцати, а не по всей истории', () => {
    // Человек растёт: ролики годовой давности говорят о том, кем он был.
    const oldOnes = Array.from({ length: 20 }, (_, i) => video(200 + i, 1000, `old${i}`));
    const fresh = Array.from({ length: 20 }, (_, i) => video(20 + i, 9000, `new${i}`));
    expect(typicalVideo([...oldOnes, ...fresh], null, NOW)?.views).toBe(9000);
  });
});

describe('хит', () => {
  it('хит — собственный рекорд автора', () => {
    const own = [...many(10, 4000), video(40, 48_000, 'best')];
    expect(hitVideo(own, 4000, NOW)).toBe(48_000);
  });

  it('рекорд неотличим от обычного ролика — хита нет', () => {
    // «1 хит и 8 обычных» про такие числа не другой план, а тот же
    // самый другими словами.
    expect(hitVideo(many(10, 4000), 4000, NOW)).toBeNull();
  });

  it('молодой рекорд в хиты не идёт: просмотры ещё не устоялись', () => {
    expect(hitVideo([video(1, 90_000, 'fresh')], 4000, NOW)).toBeNull();
  });

  it('без типичного ролика хита тоже нет', () => {
    expect(hitVideo(many(2, 4000), null, NOW)).toBeNull();
  });
});

describe('положение на шкале', () => {
  it('ступень — сто тысяч; пройденные и следующая считаются от неё', () => {
    const s = ladderState(320_000);
    expect(LADDER_STEP).toBe(100_000);
    expect(s.passed).toBe(3);
    expect(s.nextAt).toBe(400_000);
    expect(s.toNext).toBe(80_000);
    expect(s.progress).toBeCloseTo(0.2, 5);
  });

  it('ровно на ступени следующая — та, что дальше', () => {
    const s = ladderState(200_000);
    expect(s.passed).toBe(2);
    expect(s.nextAt).toBe(300_000);
    expect(s.toNext).toBe(100_000);
  });

  it('перенос с прошлого периода входит в счёт', () => {
    // 50 тыс. переноса в первый день периода — это «уже 50 тыс.»,
    // и человек должен видеть, откуда они.
    expect(ladderState(50_000 + 12_400).views).toBe(62_400);
  });

});

/**
 * Подписи шкалы.
 *
 * Прежняя звучала «до ступени 100 тыс. — это 34 обычных ролика». Число
 * верное и бесполезное сразу с двух сторон: тридцати четырёх дат в
 * периоде не бывает, то есть совету нельзя последовать, а читается он
 * как «у тебя нет шансов». По данным площадки ступень закрывается иначе:
 * один сильный ролик и два хороших. Поэтому хиты идут первыми, а
 * количество — вторым и только когда количеством действительно можно
 * успеть.
 */
describe('чем закрыть ступень', () => {
  it('один ролик на весь остаток или два по половине', () => {
    const p = stepPlan(100_000, 3_000, 10)!;
    expect(p.oneVideo).toBe(100_000);
    expect(p.twoVideos).toBe(50_000);
    expect(hitLine(p)).toContain('Один ролик на');
    expect(hitLine(p)).toContain('Или два по');
  });

  it('нечётный остаток делится вверх: два ролика должны закрыть его', () => {
    expect(stepPlan(45_001, 3_000, 10)!.twoVideos).toBe(22_501);
  });

  it('обычными — с округлением вверх: недобравший ролик ступень не берёт', () => {
    expect(stepPlan(100_000, 3_000, 40)!.normal).toBe(34);
  });

  it('ступень уже взята — плана нет вовсе', () => {
    expect(stepPlan(0, 3_000, 10)).toBeNull();
  });

  it('типичного ролика нет — количеством не считаем, но хитами считаем', () => {
    const p = stepPlan(100_000, null, 10)!;
    expect(p.normal).toBeNull();
    expect(hitLine(p)).toContain('Один ролик на');
    expect(countLine(p)).toBe('');
  });

  // Ровно то, за что экран и ругали: «сними ещё 34» при десяти
  // оставшихся датах — это не совет, а приговор.
  it('обычных нужно больше, чем осталось дат: количеством не советуем', () => {
    const p = stepPlan(100_000, 3_000, 10)!;
    expect(p.normal).toBe(34);
    expect(p.beyondPlan).toBeTrue();
    expect(countLine(p)).toBe('');
  });

  it('дат впереди не осталось — про количество молчим', () => {
    const p = stepPlan(100_000, 3_000, 0)!;
    expect(p.plannedLeft).toBe(0);
    expect(countLine(p)).toBe('');
  });

  it('количеством успеть можно — говорим и сколько роликов, и сколько дат', () => {
    const p = stepPlan(30_000, 3_000, 12)!;
    expect(p.normal).toBe(10);
    expect(p.beyondPlan).toBeFalse();
    expect(countLine(p)).toBe('Обычными — это 10 обычных роликов, а впереди по плану 12 дат.');
  });
});

/**
 * Вклад ролика долей ступени.
 *
 * Без него «20 000» не говорит, много это или мало. Мелкие доли не
 * округляем до нуля: «0% ступени» читается как «не дал ничего», а ролик
 * дал ровно столько, сколько дал.
 */
describe('доля ступени по ролику', () => {
  it('пятая часть ступени — двадцать процентов', () => {
    expect(stepShareText(20_000)).toBe('20% ступени');
  });

  it('половина ступени', () => {
    expect(stepShareText(50_000)).toBe('50% ступени');
  });

  it('мелкий вклад показывается долями процента, а не нулём', () => {
    expect(stepShareText(3_000)).toBe('3% ступени');
    expect(stepShareText(500)).toBe('0,5% ступени');
  });

  it('совсем мелкий — «меньше 0,1%», а не «0%»', () => {
    expect(stepShareText(50)).toBe('меньше 0,1% ступени');
  });

  it('ролик больше ступени — считаем ступенями, а не 320%', () => {
    expect(stepShareText(320_000)).toBe('3,2 ступени');
  });

  // «1 ступени» и «5 ступени» — машинный перевод, а не русский язык.
  it('целое число ступеней склоняется', () => {
    expect(stepShareText(100_000)).toBe('1 ступень');
    expect(stepShareText(200_000)).toBe('2 ступени');
    expect(stepShareText(500_000)).toBe('5 ступеней');
  });

  it('просмотров нет — так и говорим, без процентов', () => {
    expect(stepShareText(0)).toBe('пока ничего к ступени');
  });
});

describe('просмотры короткой строкой', () => {
  const NB = ' ';

  it('ровные тысячи — «80 тыс.»', () => {
    expect(shortViews(80_000)).toBe(`80${NB}тыс.`);
  });

  it('неровное число показывается целиком: 12 400 — это не «12 тыс.»', () => {
    // Прячет ровно ту разницу, из-за которой человек и смотрит на число.
    expect(shortViews(12_400)).toBe(`12${NB}400`);
  });

  it('миллионы — с десятой долей', () => {
    expect(shortViews(1_200_000)).toBe(`1,2${NB}млн`);
    expect(shortViews(3_000_000)).toBe(`3${NB}млн`);
  });
});
