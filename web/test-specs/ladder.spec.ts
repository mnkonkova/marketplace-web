import {
  LADDER_STEP,
  LadderVideo,
  bestVideos,
  forecastViews,
  hitVideo,
  isMature,
  ladderMarks,
  ladderState,
  median,
  shortViews,
  typicalVideo,
  videoTarget,
  videosToStep,
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

  it('на шкале видно пройденные ступени и следующую', () => {
    expect(ladderMarks(ladderState(320_000))).toEqual([100_000, 200_000, 300_000, 400_000]);
  });

  it('в самом начале шкала не уходит в отрицательные ступени', () => {
    expect(ladderMarks(ladderState(12_400))).toEqual([100_000]);
  });
});

describe('сколько роликов до ступени', () => {
  it('обычными — с округлением вверх: недобравший ролик ступень не берёт', () => {
    expect(videosToStep(80_000, 4000).normal).toBe(20);
    expect(videosToStep(80_001, 4000).normal).toBe(21);
  });

  it('вариант с хитом: один хит и остаток обычными', () => {
    expect(videosToStep(80_000, 4000, 48_000)).toEqual({ normal: 20, withHit: 8 });
  });

  it('хит закрывает ступень сам — обычных не нужно', () => {
    expect(videosToStep(80_000, 4000, 120_000).withHit).toBe(0);
  });

  it('хита нет — варианта с хитом тоже нет, а не «1 хит и 19 обычных»', () => {
    expect(videosToStep(80_000, 4000, null).withHit).toBeNull();
    expect(videosToStep(80_000, 4000, 6000).withHit).toBeNull();
  });

  it('типичного ролика нет — считать нечего', () => {
    expect(videosToStep(80_000, 0)).toEqual({ normal: 0, withHit: null });
  });

  it('ступень уже взята — роликов до неё ноль', () => {
    expect(videosToStep(0, 4000).normal).toBe(0);
  });
});

describe('прогноз на конец периода', () => {
  it('складывает то, что есть, дорост молодых и ещё не вышедшие ролики', () => {
    // 320 000 сейчас, два молодых по 1 000 (каждому до типичного 3 000)
    // и пять роликов впереди по 4 000.
    const f = forecastViews({
      current: 320_000,
      young: [1000, 1000],
      typical: 4000,
      plannedLeft: 5,
    });
    expect(f).toBe(320_000 + 6000 + 20_000);
  });

  it('переросший типичный ролик в прогнозе не отнимает', () => {
    // Он просто перестаёт расти по этой модели, а не начинает терять
    // просмотры.
    const f = forecastViews({ current: 100_000, young: [50_000], typical: 4000, plannedLeft: 0 });
    expect(f).toBe(100_000);
  });

  it('без роликов впереди прогноз равен тому, что уже набрано', () => {
    expect(forecastViews({ current: 62_400, young: [], typical: 4000, plannedLeft: 0 })).toBe(
      62_400,
    );
  });
});

describe('куда тянуть конкретный ролик', () => {
  it('ниже типичного — показываем, сколько до него', () => {
    expect(videoTarget(12_400, 15_000)).toEqual({ level: 'typical', left: 2600 });
  });

  it('выше типичного — следующая отметка это собственный рекорд', () => {
    expect(videoTarget(20_000, 15_000, 48_000)).toEqual({ level: 'best', left: 28_000 });
  });

  it('рекорд побит — тянуть больше некуда', () => {
    expect(videoTarget(50_000, 15_000, 48_000)).toEqual({ level: 'top', left: 0 });
  });

  it('без типичного ролика отметок нет', () => {
    expect(videoTarget(12_400, 0)).toBeNull();
  });
});

describe('лучшее за период', () => {
  it('три лучших ролика, по убыванию просмотров', () => {
    const items = [
      video(3, 1000, 'a'),
      video(4, 9000, 'b'),
      video(5, 5000, 'c'),
      video(6, 7000, 'd'),
    ];
    expect(bestVideos(items).map((v) => v.id)).toEqual(['b', 'd', 'c']);
  });

  it('невышедшие и пустые ролики в подборку не попадают', () => {
    expect(bestVideos([{ id: 'x', views: 5000 }, video(3, 0, 'y')])).toEqual([]);
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
