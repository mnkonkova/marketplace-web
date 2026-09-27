import {
  PROJECT_KIND_LABEL,
  PROJECT_STATUS_LABEL,
  PROJECT_STATUS_COLOR,
  STAGE_STATUS_LABEL,
  STAGE_STATUS_COLOR,
  OWNER_LABEL,
  getStepBadge,
  projectProgressMeasure,
  projectStageLabel,
} from '@shared/lib/project-status';

describe('PROJECT_STATUS_LABEL/COLOR', () => {
  it('покрывает все display_status значения', () => {
    // Сверяемся с типом — TS ругнётся при компиляции если что-то выпадет.
    const statuses: (keyof typeof PROJECT_STATUS_LABEL)[] = [
      'not_started',
      'in_progress',
      'waiting_action',
      'completed',
      'on_hold',
      'cancelled',
    ];
    for (const s of statuses) {
      expect(PROJECT_STATUS_LABEL[s]).toBeTruthy();
      expect(PROJECT_STATUS_COLOR[s]).toBeTruthy();
    }
  });

  it('маппинги стабильны (защита от случайной правки текста)', () => {
    expect(PROJECT_STATUS_LABEL.waiting_action).toBe('Ждёт вас');
    expect(PROJECT_STATUS_COLOR.completed).toBe('green');
    expect(PROJECT_STATUS_COLOR.cancelled).toBe('red');
  });
});

describe('STAGE_STATUS_LABEL/COLOR + OWNER_LABEL', () => {
  it('содержат все ожидаемые ключи', () => {
    expect(STAGE_STATUS_LABEL.active).toBe('В работе');
    expect(STAGE_STATUS_COLOR.completed).toBe('green');
    expect(OWNER_LABEL.client).toBe('вы');
    expect(OWNER_LABEL.team).toBe('команда');
    expect(OWNER_LABEL.system).toBe('система');
  });
});

describe('getStepBadge', () => {
  it('done и skipped одинаково отображаются как «Готово» green', () => {
    expect(getStepBadge('done', 'team')).toEqual({ label: 'Готово', color: 'green' });
    expect(getStepBadge('skipped', 'team')).toEqual({ label: 'Готово', color: 'green' });
    expect(getStepBadge('skipped', 'client')).toEqual({ label: 'Готово', color: 'green' });
  });

  it('in_progress → «В работе» синий, независимо от owner', () => {
    expect(getStepBadge('in_progress', 'team')).toEqual({ label: 'В работе', color: 'blue' });
    expect(getStepBadge('in_progress', 'client')).toEqual({ label: 'В работе', color: 'blue' });
  });

  it('waiting_client+client → «Ждёт вас» (gold)', () => {
    expect(getStepBadge('waiting_client', 'client')).toEqual({
      label: 'Ждёт вас',
      color: 'gold',
    });
  });

  it('waiting_client+team/system → «В работе» (мяч у команды)', () => {
    expect(getStepBadge('waiting_client', 'team')).toEqual({ label: 'В работе', color: 'blue' });
    expect(getStepBadge('waiting_client', 'system')).toEqual({ label: 'В работе', color: 'blue' });
  });

  it('rejected → «Возврат» orange', () => {
    expect(getStepBadge('rejected', 'team')).toEqual({ label: 'Возврат', color: 'orange' });
  });

  it('pending → «Впереди» default', () => {
    expect(getStepBadge('pending', 'team')).toEqual({ label: 'Впереди', color: 'default' });
  });
});

describe('projectProgressMeasure', () => {
  // Главное, что проверяем: одна и та же цифра у разных видов проекта
  // означает разное, и подпись обязана это называть.
  it('у креаторов меряет выкладками, у продакшна — шагами', () => {
    expect(projectProgressMeasure('creators_turnkey', 42).caption).toBe('по выкладкам');
    expect(projectProgressMeasure('production_turnkey', 42).caption).toBe('по шагам');
  });

  it('процент округляется и не вылезает за 0..100', () => {
    expect(projectProgressMeasure('production_turnkey', 66.666).percent).toBe(67);
    expect(projectProgressMeasure('production_turnkey', -5).percent).toBe(0);
    expect(projectProgressMeasure('production_turnkey', 140).percent).toBe(100);
  });

  // У общего проекта нет ни шагов, ни выкладок: «0%» читалось бы как
  // «ничего не сделано», хотя мерить попросту нечем.
  it('у общего проекта прогресса нет — percent=null и объяснение', () => {
    const m = projectProgressMeasure('general', 0);
    expect(m.percent).toBeNull();
    expect(m.hint).toContain('не по чему');
  });
});

describe('projectStageLabel', () => {
  it('стадия есть — показываем её', () => {
    expect(projectStageLabel('production_turnkey', 'Монтаж')).toBe('Монтаж');
  });

  // Прочерк в колонке выглядел как потерянные данные, хотя терять нечего:
  // стадии бывают только у продакшна.
  it('стадии нет — объясняем почему, а не ставим прочерк', () => {
    expect(projectStageLabel('creators_turnkey')).toBe('Без стадий — план выкладок');
    expect(projectStageLabel('general')).toBe('Без стадий — один срок');
    expect(projectStageLabel('production_turnkey')).toBe('Все стадии пройдены');
  });
});

/**
 * Пустой план — не «всё закрыто».
 *
 * У проекта с креаторами, которому ещё не проставили даты, бэк отдаёт
 * progress = 100: делить нечего, и доля выходит полной. Полоска
 * рапортовала «100% по выкладкам» там, где закрывать было нечего, —
 * то есть поздравляла с несделанным.
 */
describe('прогресс при пустом плане', () => {
  it('нет выкладок — полоски нет, а есть объяснение', () => {
    const m = projectProgressMeasure('creators_turnkey', 100, 0);
    expect(m.percent).toBeNull();
    expect(m.caption).toBe('дат в плане нет');
  });

  it('нет шагов — то же самое у продакшна', () => {
    expect(projectProgressMeasure('production_turnkey', 100, 0).percent).toBeNull();
  });

  it('план есть — считаем как считали', () => {
    const m = projectProgressMeasure('creators_turnkey', 60, 5);
    expect(m.percent).toBe(60);
    expect(m.caption).toBe('по выкладкам');
  });

  // Старые вызовы без третьего аргумента ничего не теряют: «сколько
  // всего» им неизвестно, и выдумывать за них «мерить нечего» нельзя.
  it('без числа выкладок поведение прежнее', () => {
    expect(projectProgressMeasure('creators_turnkey', 100).percent).toBe(100);
  });
});

/**
 * Бренд под ключ — тот же план выкладок, только ролики выходят с
 * аккаунтов бренда. Ни стадий, ни шагов у него нет, и мерить его надо
 * ровно тем же, чем проект с креаторами: иначе два одинаковых по сути
 * проекта показывали бы в списке разные меры.
 */
describe('бренд под ключ', () => {
  it('у вида есть человеческое название', () => {
    expect(PROJECT_KIND_LABEL.brand_turnkey).toBe('Бренд под ключ');
  });

  it('прогресс меряется выкладками — как у креаторов', () => {
    const m = projectProgressMeasure('brand_turnkey', 42, 10);
    expect(m.percent).toBe(42);
    expect(m.caption).toBe('по выкладкам');
  });

  it('дат в плане нет — полоски нет, а есть объяснение', () => {
    const m = projectProgressMeasure('brand_turnkey', 100, 0);
    expect(m.percent).toBeNull();
    expect(m.caption).toBe('дат в плане нет');
  });

  it('стадий нет — говорим про план выкладок, а не ставим прочерк', () => {
    expect(projectStageLabel('brand_turnkey')).toBe('Без стадий — план выкладок');
  });
});
