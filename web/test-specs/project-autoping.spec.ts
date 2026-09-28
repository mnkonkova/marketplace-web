import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { NzMessageService } from 'ng-zorro-antd/message';
import { of, throwError } from 'rxjs';

import { PublicationApi } from '@entities/publication/api/publication.api';
import type { ReminderPrefs } from '@entities/publication/model/publication.types';
import { ProjectAutopingComponent } from '@widgets/project-autoping/project-autoping.component';

/**
 * Автопинг проекта: по выключателю на каждый вид напоминания.
 *
 * Главное, что здесь легко потерять: умолчание у «накануне» ОБРАТНОЕ
 * остальным. Три первых вида были с самого начала и на них
 * рассчитывают, а «накануне» появилось позже — включить его молча всем
 * значит завтра утром написать каждому креатору каждого проекта, никого
 * не спросив.
 */
describe('ProjectAutopingComponent', () => {
  function prefs(over: Partial<ReminderPrefs> = {}): ReminderPrefs {
    return {
      project_id: 'pr1',
      due_today: true,
      overdue: true,
      incomplete: true,
      manager_digest: true,
      day_before: false,
      ...over,
    };
  }

  function setup(loaded: ReminderPrefs | null = prefs(), crew = true) {
    TestBed.resetTestingModule();
    const api = jasmine.createSpyObj<PublicationApi>('pubApi', [
      'managerAutoping',
      'managerSaveAutoping',
    ]);
    api.managerAutoping.and.returnValue(
      loaded ? (of(loaded) as never) : (throwError(() => ({ status: 500 })) as never),
    );
    api.managerSaveAutoping.and.callFake(
      (_id: string, patch: Partial<ReminderPrefs>) => of({ ...prefs(), ...patch }) as never,
    );
    const msg = jasmine.createSpyObj<NzMessageService>('msg', ['error']);
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: PublicationApi, useValue: api },
        { provide: NzMessageService, useValue: msg },
      ],
    });
    TestBed.overrideComponent(ProjectAutopingComponent, { set: { template: '' } });
    const fixture = TestBed.createComponent(ProjectAutopingComponent);
    fixture.componentRef.setInput('projectId', 'pr1');
    fixture.componentRef.setInput('crew', crew);
    fixture.detectChanges();
    return { cmp: fixture.componentInstance, api, msg };
  }

  it('видов пять, и «накануне» стоит первым — им пользуются чаще', () => {
    const { cmp } = setup();
    expect(cmp.rows().map((r) => r.field)).toEqual([
      'day_before',
      'due_today',
      'overdue',
      'incomplete',
      'manager_digest',
    ]);
  });

  /**
   * Проект без креаторов: остаётся один тумблер.
   *
   * Четыре из пяти обещают письмо КРЕАТОРУ, а бэк такие напоминания у
   * проекта без состава не отправляет вовсе: ни в личку (некому), ни в
   * чат (шестьдесят «просрочка» за одно утро по одному проекту). Их
   * единственный след — дневная сводка менеджерам.
   */
  it('у проекта без креаторов остаётся только сводка менеджерам', () => {
    const { cmp } = setup(prefs(), false);
    expect(cmp.rows().map((r) => r.field)).toEqual(['manager_digest']);
  });

  it('проект, где ничего не трогали, пингуется — кроме «накануне»', () => {
    const { cmp } = setup(null); // настроек нет вовсе
    expect(cmp.value('due_today')).toBeTrue();
    expect(cmp.value('overdue')).toBeTrue();
    expect(cmp.value('incomplete')).toBeTrue();
    expect(cmp.value('manager_digest')).toBeTrue();
    expect(cmp.value('day_before')).toBeFalse();
  });

  it('состояние тумблеров приходит с сервера, а не угадывается', () => {
    const { cmp } = setup(prefs({ overdue: false, day_before: true }));
    expect(cmp.value('overdue')).toBeFalse();
    expect(cmp.value('day_before')).toBeTrue();
  });

  /**
   * PUT шлёт ОДНО поле: два открытых экрана менеджера иначе затирают
   * друг другу соседние тумблеры.
   */
  it('сохраняется только переключённое поле', () => {
    const { cmp, api } = setup();
    cmp.toggle('day_before');
    expect(api.managerSaveAutoping).toHaveBeenCalledWith('pr1', { day_before: true });
    expect(cmp.value('day_before')).toBeTrue();
  });

  /**
   * Тумблер, показывающий не то, что на сервере, хуже тумблера, который
   * не нажался: менеджер уйдёт со страницы уверенным, что бот молчит.
   */
  it('отказ сервера возвращает тумблер как было', () => {
    const { cmp, api, msg } = setup();
    api.managerSaveAutoping.and.returnValue(throwError(() => ({ status: 500 })) as never);
    cmp.toggle('overdue');
    expect(cmp.value('overdue')).toBeTrue();
    expect(msg.error).toHaveBeenCalled();
  });
});
