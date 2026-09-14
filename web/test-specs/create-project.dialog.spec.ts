import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { NzMessageService } from 'ng-zorro-antd/message';
import { NZ_MODAL_DATA, NzModalRef } from 'ng-zorro-antd/modal';
import { of } from 'rxjs';

import { CreateProjectPayload, ProjectApi } from '@entities/project/api/project.api';
import { CreateProjectDialogComponent } from '@features/create-project/create-project.dialog';

/**
 * Окно создания проекта.
 *
 * Держит нижнюю границу названия. Пока её не было, в списке заводились
 * «12345675432» и «  ы  »: такой проект не находится ни поиском, ни
 * глазами. Ту же границу проверяет сервер — здесь она экономит круг до
 * него и объясняет человеку, что не так, до отправки.
 */
describe('CreateProjectDialogComponent', () => {
  let api: jasmine.SpyObj<ProjectApi>;
  let msg: jasmine.SpyObj<NzMessageService>;

  function setup(): CreateProjectDialogComponent {
    TestBed.resetTestingModule();
    api = jasmine.createSpyObj<ProjectApi>('ProjectApi', [
      'adminCreateProject',
      'managerCreateProject',
    ]);
    api.adminCreateProject.and.returnValue(of({ id: 'p1' }) as never);
    msg = jasmine.createSpyObj<NzMessageService>('msg', ['success', 'error']);
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: ProjectApi, useValue: api },
        { provide: NzMessageService, useValue: msg },
        { provide: NzModalRef, useValue: jasmine.createSpyObj<NzModalRef>('ref', ['destroy']) },
        { provide: NZ_MODAL_DATA, useValue: { mode: 'admin' } },
        { provide: Router, useValue: jasmine.createSpyObj<Router>('router', ['navigate']) },
      ],
    });
    TestBed.overrideComponent(CreateProjectDialogComponent, { set: { template: '' } });
    const fixture = TestBed.createComponent(CreateProjectDialogComponent);
    fixture.detectChanges();
    const cmp = fixture.componentInstance;
    cmp.clientMode = 'no_account';
    cmp.clientName = 'Ромашка';
    cmp.clientContact = '+79990000000';
    return cmp;
  }

  function payload(): CreateProjectPayload {
    return api.adminCreateProject.calls.mostRecent().args[0];
  }

  it('название короче трёх символов не отправляется', () => {
    for (const bad of ['', ' ', 'ы', 'ab']) {
      const cmp = setup();
      cmp.title = bad;
      cmp.submit();
      expect(api.adminCreateProject).not.toHaveBeenCalled();
      expect(msg.error).toHaveBeenCalled();
    }
  });

  it('пробелы по краям не считаются символами', () => {
    const cmp = setup();
    // Три пробела вокруг одной буквы — это одна буква, а не пять символов.
    cmp.title = '   ы   ';
    cmp.submit();
    expect(api.adminCreateProject).not.toHaveBeenCalled();
  });

  it('нормальное название уходит обрезанным', () => {
    const cmp = setup();
    cmp.title = '  Промо-ролик  ';
    cmp.submit();
    expect(payload().title).toBe('Промо-ролик');
  });

  it('отметка «тестовый» уезжает на сервер', () => {
    const cmp = setup();
    cmp.title = 'Проверка стенда';
    cmp.isTest = true;
    cmp.submit();
    expect(payload().is_test).toBeTrue();
  });

  it('без отметки признак не шлём — проект обычный', () => {
    const cmp = setup();
    cmp.title = 'Промо-ролик';
    cmp.submit();
    expect(payload().is_test).toBeUndefined();
  });
});
