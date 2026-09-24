import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { NzMessageService } from 'ng-zorro-antd/message';
import { NzModalService } from 'ng-zorro-antd/modal';
import { of } from 'rxjs';

import { PublicationApi } from '@entities/publication/api/publication.api';
import type { ChecklistItem } from '@entities/publication/model/publication.types';
import { ProjectChecklistComponent } from '@widgets/project-checklist/project-checklist.component';

/**
 * Свой пункт чек-листа под проект.
 *
 * Здесь проверяется ровно то, что однажды сломалось молча: форма
 * отправлялась БРАУЗЕРУ. Обработчик висел на «ngSubmit», а NgForm к
 * этой форме не подключён — поля читаются напрямую, без ngModel, — и
 * событие с таким именем просто не наступало. Нажатие на «Добавить»
 * перезагружало страницу, пункт не добавлялся, и ни в консоли, ни в
 * сети следов не оставалось.
 *
 * Поэтому тест жмёт на настоящую кнопку в настоящей форме, а не зовёт
 * метод: вызванный напрямую, метод работал и тогда.
 */
describe('ProjectChecklistComponent: свой пункт под проект', () => {
  function item(over: Partial<ChecklistItem> = {}): ChecklistItem {
    return {
      id: 'new',
      project_id: 'pr1',
      text: 'Шрифт титров — Onest Bold',
      is_required: true,
      sort_order: 10,
      added_for_project: true,
      ...over,
    } as ChecklistItem;
  }

  function setup() {
    TestBed.resetTestingModule();
    const api = jasmine.createSpyObj<PublicationApi>('pubApi', [
      'managerChecklist',
      'managerChecklistTemplates',
      'managerAddChecklistItem',
      'managerDeleteChecklistItem',
      'managerSnapshotChecklist',
    ]);
    // Форма своего пункта стоит под подключённым чеклистом: пустому
    // проекту сперва предлагают взять шаблон из библиотеки.
    api.managerChecklist.and.returnValue(
      of({ items: [item({ id: 'base', text: 'Логотип в первые 3 секунды' })] }) as never,
    );
    api.managerChecklistTemplates.and.returnValue(of({ items: [] }) as never);
    api.managerAddChecklistItem.and.returnValue(of(item()) as never);

    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: PublicationApi, useValue: api },
        { provide: NzMessageService, useValue: jasmine.createSpyObj('msg', ['success', 'error']) },
        { provide: NzModalService, useValue: jasmine.createSpyObj('modal', ['confirm']) },
      ],
    });
    const fixture = TestBed.createComponent(ProjectChecklistComponent);
    fixture.componentRef.setInput('projectId', 'pr1');
    fixture.detectChanges();
    return { fixture, api, el: fixture.nativeElement as HTMLElement };
  }

  function fill(fixture: ReturnType<typeof setup>['fixture'], el: HTMLElement, text: string) {
    const input = el.querySelector<HTMLInputElement>('.addck input[type="text"]')!;
    input.value = text;
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  }

  it('кнопка «Добавить» отправляет пункт на сервер, а не форму браузеру', () => {
    const { fixture, api, el } = setup();
    fill(fixture, el, 'Шрифт титров — Onest Bold');

    const form = el.querySelector<HTMLFormElement>('form.addck')!;
    const submit = new Event('submit', { cancelable: true, bubbles: true });
    form.dispatchEvent(submit);
    fixture.detectChanges();

    expect(submit.defaultPrevented)
      .withContext('форма ушла браузеру — страница перезагрузится, пункт пропадёт')
      .toBeTrue();
    // Галочка «обязательный» стоит по умолчанию — как в макете, где
    // тип пункта начинается с «Требование».
    expect(api.managerAddChecklistItem).toHaveBeenCalledWith('pr1', {
      text: 'Шрифт титров — Onest Bold',
      is_required: true,
    });
  });

  it('добавленный пункт появляется в списке сразу, без перезагрузки', () => {
    const { fixture, el } = setup();
    fill(fixture, el, 'Шрифт титров — Onest Bold');
    el.querySelector<HTMLFormElement>('form.addck')!.dispatchEvent(
      new Event('submit', { cancelable: true, bubbles: true }),
    );
    fixture.detectChanges();

    expect(el.textContent).toContain('Шрифт титров — Onest Bold');
    expect(el.querySelector<HTMLInputElement>('.addck input[type="text"]')!.value)
      .withContext('поле не очистилось — следующий пункт наберут поверх старого')
      .toBe('');
  });

  /** Пустой пункт не отправляем: кнопка гасится, и сервер не дёргается. */
  it('пустой пункт не отправляется', () => {
    const { fixture, api, el } = setup();
    fill(fixture, el, '   ');
    el.querySelector<HTMLFormElement>('form.addck')!.dispatchEvent(
      new Event('submit', { cancelable: true, bubbles: true }),
    );
    fixture.detectChanges();
    expect(api.managerAddChecklistItem).not.toHaveBeenCalled();
  });
});
