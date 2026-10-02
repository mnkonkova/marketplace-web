import { TestBed } from '@angular/core/testing';
import { NzMessageService } from 'ng-zorro-antd/message';
import { of, throwError } from 'rxjs';

import { DocumentApi } from '@entities/document/api/document.api';
import type {
  DocumentTemplate,
  MyDocument,
  UserDocument,
} from '@entities/document/model/document.types';
import { MyDocumentsComponent } from '@widgets/my-documents/my-documents.component';
import { ProjectDocumentsComponent } from '@widgets/project-documents/project-documents.component';

/**
 * Документы: выдача у менеджера и «Мои документы» у адресата.
 *
 * Разметку здесь не проверяем — её ловят сквозные тесты; здесь правила:
 * когда форму можно отправить, что уходит на сервер и когда документ
 * отмечается открытым.
 */
describe('документы', () => {
  function template(over: Partial<DocumentTemplate> = {}): DocumentTemplate {
    return {
      id: 't1',
      kind: 'contract',
      title: 'Договор с креатором',
      audience: 'creators',
      created_at: '2026-10-01T00:00:00Z',
      current: {
        id: 'v3',
        template_id: 't1',
        version: 3,
        url: 'https://docs.example.com/v3',
        published_at: '2026-09-28T00:00:00Z',
      },
      ...over,
    };
  }

  describe('выдача у менеджера', () => {
    function setup(templates: DocumentTemplate[] = [template()]) {
      TestBed.resetTestingModule();
      const api = jasmine.createSpyObj<DocumentApi>('api', [
        'managerProjectDocuments',
        'managerTemplates',
        'managerDeliver',
        'managerRevoke',
      ]);
      api.managerProjectDocuments.and.returnValue(of({ items: [] as UserDocument[] }));
      api.managerTemplates.and.returnValue(of({ items: templates }));
      api.managerDeliver.and.returnValue(of({ items: [] as UserDocument[] }));
      TestBed.configureTestingModule({
        providers: [
          { provide: DocumentApi, useValue: api },
          {
            provide: NzMessageService,
            useValue: jasmine.createSpyObj('msg', ['success', 'error']),
          },
        ],
      });
      TestBed.overrideComponent(ProjectDocumentsComponent, { set: { template: '' } });
      const fixture = TestBed.createComponent(ProjectDocumentsComponent);
      fixture.componentRef.setInput('projectId', 'pr1');
      fixture.componentRef.setInput('crew', [
        { user_id: 'u1', display_name: 'Анастасия', added_at: '2026-09-01' },
        { user_id: 'u2', display_name: 'Игорь', added_at: '2026-09-01' },
      ]);
      fixture.componentRef.setInput('clientName', 'ООО «ПетФлэт»');
      fixture.detectChanges();
      return { cmp: fixture.componentInstance, api };
    }

    it('без выбранного шаблона выдать нельзя', () => {
      const { cmp } = setup();
      cmp.open();
      expect(cmp.canSend()).toBeFalse();
      cmp.templateId.set('t1');
      expect(cmp.canSend()).toBeTrue();
    });

    it('сняли «всем» и никого не отметили — выдать некому', () => {
      const { cmp } = setup();
      cmp.open();
      cmp.templateId.set('t1');
      cmp.setAll(false);
      expect(cmp.canSend()).toBeFalse();
      cmp.togglePerson('u2');
      expect(cmp.canSend()).toBeTrue();
      expect(cmp.pickedCount()).toBe(1);
    });

    it('одному человеку — уходит только он', () => {
      const { cmp, api } = setup();
      cmp.open();
      cmp.templateId.set('t1');
      cmp.togglePerson('u1');
      cmp.note = 'подпишите и пришлите в комментарии';
      cmp.send();
      const body = api.managerDeliver.calls.mostRecent().args[1];
      expect(body.recipient_ids).toEqual(['u1']);
      expect(body.template_id).toBe('t1');
      expect(body.note).toBe('подпишите и пришлите в комментарии');
    });

    it('«всем» — список адресатов не передаётся: сервер берёт весь состав', () => {
      const { cmp, api } = setup();
      cmp.open();
      cmp.templateId.set('t1');
      cmp.send();
      expect(api.managerDeliver.calls.mostRecent().args[1].recipient_ids).toBeUndefined();
    });

    it('шаблонов для стороны нет — форма сразу на «своей ссылке»', () => {
      const { cmp } = setup([template({ audience: 'creators' })]);
      cmp.open();
      cmp.setAudience('client');
      expect(cmp.audienceTemplates().length).toBe(0);
      expect(cmp.source()).toBe('custom');
      expect(cmp.canSend()).toBeFalse();
      cmp.custom = { kind: 'act', title: 'Акт сверки', url: 'https://docs.example.com/a' };
      expect(cmp.canSend()).toBeTrue();
    });
  });

  describe('мои документы', () => {
    function doc(over: Partial<MyDocument> = {}): MyDocument {
      return {
        id: 'd1',
        source: 'personal',
        project_id: 'pr1',
        project_title: 'PetFlat',
        kind: 'act',
        title: 'Акт за сентябрь',
        url: 'https://docs.example.com/a',
        sent_at: '2026-10-01T00:00:00Z',
        ...over,
      };
    }

    function setup(items: MyDocument[]) {
      TestBed.resetTestingModule();
      const api = jasmine.createSpyObj<DocumentApi>('api', ['myDocuments', 'markOpened']);
      api.myDocuments.and.returnValue(of({ items }));
      api.markOpened.and.returnValue(of({ opened_at: '2026-10-02T10:00:00Z' }));
      TestBed.configureTestingModule({ providers: [{ provide: DocumentApi, useValue: api }] });
      TestBed.overrideComponent(MyDocumentsComponent, { set: { template: '' } });
      const fixture = TestBed.createComponent(MyDocumentsComponent);
      return { fixture, cmp: fixture.componentInstance, api };
    }

    it('в карточке проекта — просит у сервера только этот проект', () => {
      const { fixture, api } = setup([doc()]);
      fixture.componentRef.setInput('projectId', 'pr1');
      fixture.detectChanges();
      expect(api.myDocuments).toHaveBeenCalledOnceWith('pr1', false);
    });

    it('рядом со списком материалов — только выданное лично, без дубля договора', () => {
      const { fixture, cmp, api } = setup([doc(), doc({ id: 'm1', source: 'project' })]);
      fixture.componentRef.setInput('personalOnly', true);
      fixture.detectChanges();
      expect(api.myDocuments).toHaveBeenCalledOnceWith('', true);
      // И на клиенте тоже: старый API параметр source пропустит.
      expect(cmp.items().map((d) => d.id)).toEqual(['d1']);
    });

    it('API без фильтра по проекту — чужой проект в карточку не попадает', () => {
      const { fixture, cmp } = setup([doc(), doc({ id: 'd2', project_id: 'pr2' })]);
      fixture.componentRef.setInput('projectId', 'pr1');
      fixture.detectChanges();
      expect(cmp.items().map((d) => d.id)).toEqual(['d1']);
    });

    it('сбой загрузки — странице сообщают, чтобы договор не пропал молча', () => {
      const { fixture, cmp, api } = setup([]);
      api.myDocuments.and.returnValue(throwError(() => new Error('500')));
      const seen: boolean[] = [];
      cmp.loadFailed.subscribe((v) => seen.push(v));
      fixture.detectChanges();
      expect(seen).toEqual([true]);
    });

    it('страница обновила данные — список перезагружается', () => {
      const { fixture, api } = setup([doc()]);
      fixture.detectChanges();
      fixture.componentRef.setInput('refresh', 1);
      fixture.detectChanges();
      expect(api.myDocuments).toHaveBeenCalledTimes(2);
    });

    it('правый клик — меню, а не открытие; средний — открытие', () => {
      const { fixture, cmp, api } = setup([doc()]);
      fixture.detectChanges();
      cmp.aux(new MouseEvent('auxclick', { button: 2 }), cmp.items()[0]);
      expect(api.markOpened).not.toHaveBeenCalled();
      cmp.aux(new MouseEvent('auxclick', { button: 1 }), cmp.items()[0]);
      expect(api.markOpened).toHaveBeenCalledOnceWith('d1');
    });

    it('личный документ отмечается открытым один раз', () => {
      const { fixture, cmp, api } = setup([doc()]);
      fixture.detectChanges();
      cmp.opened(cmp.items()[0]);
      expect(api.markOpened).toHaveBeenCalledOnceWith('d1');
      cmp.opened(cmp.items()[0]);
      expect(api.markOpened).toHaveBeenCalledTimes(1);
    });

    it('договор из материалов проекта открытым не отмечается — он общий', () => {
      const { fixture, cmp, api } = setup([doc({ source: 'project' })]);
      fixture.detectChanges();
      cmp.opened(cmp.items()[0]);
      expect(api.markOpened).not.toHaveBeenCalled();
    });
  });
});
