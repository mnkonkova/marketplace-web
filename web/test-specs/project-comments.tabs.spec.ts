import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { DomSanitizer } from '@angular/platform-browser';
import { NzMessageService } from 'ng-zorro-antd/message';

import { ProjectApi } from '@entities/project/api/project.api';
import { PublicationApi } from '@entities/publication/api/publication.api';
import { ProjectComment } from '@entities/project/model/project.types';
import { ProjectCommentsComponent } from '@widgets/project-comments/project-comments.component';

/**
 * Вкладки веток у менеджера.
 *
 * Ветка есть у каждого, кто в составе, и у каждой существующей ветки.
 * Раньше список собирался из имён, а имя ветки заполняется только из
 * сообщения самого креатора: ветка, где писал один менеджер, имени не
 * имеет — и выбывший из состава молчун терял вкладку вместе со всей
 * перепиской. Ровно наоборот тому, ради чего ветки и заводились.
 */
describe('ProjectCommentsComponent: вкладки веток у менеджера', () => {
  function comment(over: Partial<ProjectComment> = {}): ProjectComment {
    return {
      id: 'c1',
      project_id: 'pr1',
      author_id: 'mgr',
      author_name: 'Менеджер',
      body: 'текст',
      body_format: 'plain',
      is_internal: false,
      created_at: '2026-08-25T14:32:00Z',
      updated_at: '2026-08-25T14:32:00Z',
      ...over,
    };
  }

  function setup(comments: ProjectComment[], crew: { user_id: string; display_name: string }[]) {
    TestBed.resetTestingModule();
    const api = jasmine.createSpyObj<ProjectApi>('api', [
      'managerListComments',
      // Список участников ветки — второй запрос при выборе вкладки.
      'managerCommentParticipants',
    ]);
    api.managerListComments.and.returnValue(of({ items: comments }) as never);
    api.managerCommentParticipants.and.returnValue(of({ items: [] }) as never);
    const pubApi = jasmine.createSpyObj<PublicationApi>('pubApi', ['managerCreators']);
    pubApi.managerCreators.and.returnValue(of({ items: crew }) as never);

    TestBed.configureTestingModule({
      providers: [
        { provide: ProjectApi, useValue: api },
        { provide: PublicationApi, useValue: pubApi },
        { provide: NzMessageService, useValue: jasmine.createSpyObj('msg', ['error', 'success']) },
        {
          provide: DomSanitizer,
          useValue: { bypassSecurityTrustHtml: (v: string) => v },
        },
      ],
    });
    TestBed.overrideComponent(ProjectCommentsComponent, { set: { template: '' } });
    const fixture = TestBed.createComponent(ProjectCommentsComponent);
    fixture.componentRef.setInput('projectId', 'pr1');
    fixture.componentRef.setInput('role', 'manager');
    fixture.componentRef.setInput('meId', 'mgr');
    fixture.detectChanges();
    return fixture.componentInstance;
  }

  it('ветка выбывшего креатора остаётся, даже если он в ней не писал', () => {
    // Менеджер написал в личную ветку, креатор не ответил и выбыл из
    // состава: имени у ветки нет, но переписка есть.
    const cmp = setup(
      [comment({ id: 'c1', thread: 'creator', thread_user_id: 'gone', body: 'сдай ссылки' })],
      [{ user_id: 'active', display_name: 'Анастасия' }],
    );

    const keys = cmp.tabs().map((t) => t.key);
    expect(keys).toContain('creator:gone');
    expect(keys).toContain('creator:active');
    expect(cmp.tabs().find((t) => t.key === 'creator:gone')?.label).toBe('Без имени');
  });

  it('имя ветки берётся из сообщения самого креатора', () => {
    const cmp = setup(
      [
        comment({
          id: 'c2',
          thread: 'creator',
          thread_user_id: 'u9',
          author_id: 'u9',
          author_name: 'Андрей',
        }),
      ],
      [],
    );
    expect(cmp.tabs().find((t) => t.key === 'creator:u9')?.label).toBe('Андрей');
  });

  it('состав без переписки всё равно даёт вкладку', () => {
    const cmp = setup([], [{ user_id: 'u1', display_name: 'Анастасия' }]);
    const keys = cmp.tabs().map((t) => t.key);
    expect(keys).toEqual(['client', 'creator:u1', 'internal']);
  });

  it('черновик не переезжает в чужую ветку', () => {
    const cmp = setup([], [{ user_id: 'u1', display_name: 'Анастасия' }]);
    // Редактор один на все ветки — подменяем его настоящим элементом.
    const el = document.createElement('div');
    spyOn(cmp, 'editor' as never).and.returnValue({ nativeElement: el } as never);

    cmp.pick(cmp.tabs()[2]); // «Только менеджерам»
    el.innerHTML = 'внутренняя заметка';

    cmp.pick(cmp.tabs()[0]); // «С заказчиком»
    expect(el.innerHTML).withContext('клиентская ветка открывается пустой').toBe('');

    cmp.pick(cmp.tabs()[2]);
    expect(el.innerHTML).withContext('черновик ждёт в своей ветке').toBe('внутренняя заметка');
  });
});
