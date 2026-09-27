import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { NzMessageService } from 'ng-zorro-antd/message';
import { of, throwError } from 'rxjs';

import { PublicationApi } from '@entities/publication/api/publication.api';
import type { ProjectPerson, Publication } from '@entities/publication/model/publication.types';
import { ProjectLinksComponent } from '@widgets/project-links/project-links.component';

/**
 * Все ссылки проекта — по креаторам.
 *
 * Править ссылку можно было только в проверке, а проверка показывает
 * ОДИН ролик: тот, что сейчас на очереди. Принятый месяц назад в неё не
 * попадает — и когда он исчезает с площадки, менять адрес негде.
 */
describe('ProjectLinksComponent', () => {
  function person(over: Partial<ProjectPerson> = {}): ProjectPerson {
    return {
      user_id: over.user_id ?? 'c1',
      display_name: over.display_name ?? 'Аня',
      added_at: '2026-09-01T00:00:00Z',
      ...over,
    } as ProjectPerson;
  }

  function pub(over: Partial<Publication> = {}): Publication {
    return {
      id: over.id ?? 'p1',
      project_id: 'pr1',
      creator_user_id: over.creator_user_id ?? 'c1',
      due_date: over.due_date ?? '2026-09-10',
      status: over.status ?? 'partial',
      created_at: '2026-09-01T00:00:00Z',
      updated_at: '2026-09-01T00:00:00Z',
      links: over.links ?? [],
      overdue: false,
      views: 0,
      likes: 0,
      comments: 0,
      ...over,
    } as Publication;
  }

  function setup(people: ProjectPerson[], pubs: Publication[]) {
    TestBed.resetTestingModule();
    const api = jasmine.createSpyObj<PublicationApi>('pubApi', ['managerEditLink']);
    api.managerEditLink.and.returnValue(of(pub()) as never);
    const msg = jasmine.createSpyObj<NzMessageService>('msg', ['success', 'error']);
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: PublicationApi, useValue: api },
        { provide: NzMessageService, useValue: msg },
      ],
    });
    TestBed.overrideComponent(ProjectLinksComponent, { set: { template: '' } });
    const f = TestBed.createComponent(ProjectLinksComponent);
    f.componentRef.setInput('creators', people);
    f.componentRef.setInput('publications', pubs);
    f.detectChanges();
    return { cmp: f.componentInstance, api, msg };
  }

  it('выкладки раскладываются по людям: спрашивают всегда про человека', () => {
    const { cmp } = setup(
      [person({ user_id: 'c1', display_name: 'Аня' }), person({ user_id: 'c2', display_name: 'Лев' })],
      [pub({ id: 'a', creator_user_id: 'c1' }), pub({ id: 'b', creator_user_id: 'c2' })],
    );
    expect(cmp.groups().map((g) => [g.person.display_name, g.pubs.length])).toEqual([
      ['Аня', 1],
      ['Лев', 1],
    ]);
  });

  /**
   * Свежие сверху: адрес меняют почти всегда у недавнего ролика, того,
   * что сняли с площадки на этой неделе. Архив листают сознательно.
   */
  it('внутри человека свежие ролики идут первыми', () => {
    const { cmp } = setup(
      [person()],
      [
        pub({ id: 'old', due_date: '2026-09-01' }),
        pub({ id: 'new', due_date: '2026-09-20' }),
      ],
    );
    expect(cmp.groups()[0].pubs.map((p) => p.id)).toEqual(['new', 'old']);
  });

  it('отменённые выкладки в список не идут', () => {
    const { cmp } = setup([person()], [pub({ id: 'x', status: 'cancelled' })]);
    expect(cmp.groups()[0].pubs.length).toBe(0);
  });

  it('правка подставляет текущий адрес и шлёт новый', () => {
    const p = pub({
      id: 'p1',
      links: [{ platform: 'tiktok', url: 'https://tiktok.com/a' }] as never,
    });
    const { cmp, api } = setup([person()], [p]);
    cmp.startEdit(p, 'tiktok');
    expect(cmp.editUrl).toBe('https://tiktok.com/a');
    cmp.editUrl = 'https://tiktok.com/b';
    cmp.save(p, 'tiktok');
    expect(api.managerEditLink).toHaveBeenCalledWith('p1', 'tiktok', 'https://tiktok.com/b');
    expect(cmp.editing()).toBe('');
  });

  /**
   * Пустая площадка тоже правится: креатор прислал ссылку в переписку,
   * и перенести её — дело одной строки, а не просьбы «сдай ещё раз».
   */
  it('пустую площадку можно заполнить', () => {
    const p = pub({ id: 'p1', links: [] });
    const { cmp, api } = setup([person()], [p]);
    cmp.startEdit(p, 'vk');
    expect(cmp.editUrl).toBe('');
    cmp.editUrl = 'https://vk.com/clip-1_2';
    cmp.save(p, 'vk');
    expect(api.managerEditLink).toHaveBeenCalledWith('p1', 'vk', 'https://vk.com/clip-1_2');
  });

  it('пустой адрес не отправляется: снять площадку — не то же, что заменить', () => {
    const p = pub({ id: 'p1' });
    const { cmp, api } = setup([person()], [p]);
    cmp.startEdit(p, 'tiktok');
    cmp.editUrl = '   ';
    cmp.save(p, 'tiktok');
    expect(api.managerEditLink).not.toHaveBeenCalled();
  });

  it('отказ сервера оставляет правку открытой', () => {
    const p = pub({ id: 'p1' });
    const { cmp, api, msg } = setup([person()], [p]);
    api.managerEditLink.and.returnValue(throwError(() => ({ status: 409 })) as never);
    cmp.startEdit(p, 'tiktok');
    cmp.editUrl = 'https://tiktok.com/b';
    cmp.save(p, 'tiktok');
    expect(cmp.editing()).toBe('p1|tiktok');
    expect(msg.error).toHaveBeenCalled();
  });
});
