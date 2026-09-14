import { projectBlocks } from '@entities/publication/lib/project-blocks';

// Вид проекта теперь приходит полем kind. Раньше блоки включались догадкой
// «в проекте есть выкладки», и новый проект без проставленных дат
// выглядел так же, как проект, где выкладок не бывает вовсе.
const full = { kind: 'creators_turnkey' as const, statsAllowed: true };

describe('projectBlocks: видимость по роли', () => {
  it('клиент видит ленту, календарь и уведомления, но не выкладки и не чеклист', () => {
    const b = projectBlocks('client', full);
    expect(b.feed).toBeTrue();
    expect(b.calendar).toBeTrue();
    expect(b.notifications).toBeTrue();
    // Ручек списка выкладок и чеклиста у клиента в API нет.
    expect(b.publications).toBeFalse();
    expect(b.checklist).toBeFalse();
    expect(b.internalComments).toBeFalse();
    // Своя выгрузка у заказчика появилась: GET /me/projects/{id}/report.csv.
    expect(b.csvExport).toBeTrue();
  });

  it('у клиента цифры гаснут, когда показ статистики выключен', () => {
    const b = projectBlocks('client', { kind: 'creators_turnkey', statsAllowed: false });
    expect(b.stats).toBeFalse();
    // Лента при этом остаётся: клиент вправе видеть, что ролики выходят.
    expect(b.feed).toBeTrue();
    // Выгрузка живёт по тому же правилу, что и сам отчёт: бэк отвечает 404.
    expect(b.csvExport).toBeFalse();
  });

  it('креатор видит свои выкладки и чеклист, но не ленту клиента и не уведомления', () => {
    const b = projectBlocks('creator', full);
    expect(b.publications).toBeTrue();
    expect(b.checklist).toBeTrue();
    expect(b.stats).toBeTrue();
    expect(b.feed).toBeFalse();
    expect(b.calendar).toBeFalse();
    expect(b.notifications).toBeFalse();
    expect(b.internalComments).toBeFalse();
  });

  it('менеджер видит выкладки, внутренние комментарии, пачки и CSV', () => {
    const b = projectBlocks('manager', full);
    expect(b.publications).toBeTrue();
    expect(b.internalComments).toBeTrue();
    expect(b.batchScheduling).toBeTrue();
    expect(b.csvExport).toBeTrue();
    expect(b.notifications).toBeFalse();
  });

  it('у менеджера появились состав, автопинг и чеклист — под них есть GET', () => {
    const b = projectBlocks('manager', full);
    // GET .../creators, GET/PUT .../autoping и GET .../checklist: до них
    // ростер собирался из выкладок, а снимок чеклиста менеджер не видел
    // даже после подключения.
    expect(b.roster).toBeTrue();
    expect(b.autoping).toBeTrue();
    expect(b.checklist).toBeTrue();
  });

  it('состав и автопинг — только у менеджера', () => {
    for (const role of ['client', 'creator'] as const) {
      const b = projectBlocks(role, full);
      expect(b.roster).withContext(role).toBeFalse();
      expect(b.autoping).withContext(role).toBeFalse();
    }
  });

  it('у проекта не про креаторов не показывается ни один блок ни у одной роли', () => {
    for (const kind of ['production_turnkey', 'general'] as const) {
      for (const role of ['client', 'creator', 'manager'] as const) {
        const b = projectBlocks(role, { kind, statsAllowed: true });
        expect(Object.values(b).every((v) => v === false))
          .withContext(`${role} / ${kind}`)
          .toBeTrue();
      }
    }
  });

  it('пустой проект с креаторами блоки всё равно показывает', () => {
    // Именно этого не умела прежняя догадка по данным: у только что
    // заведённого проекта выкладок ещё нет, а страница нужна.
    const b = projectBlocks('manager', full);
    expect(b.publications).toBeTrue();
    expect(b.batchScheduling).toBeTrue();
  });
});
