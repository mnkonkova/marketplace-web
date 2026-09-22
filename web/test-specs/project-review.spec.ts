import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { NzMessageService } from 'ng-zorro-antd/message';
import { of } from 'rxjs';

import { PublicationApi } from '@entities/publication/api/publication.api';
import type {
  ChecklistItem,
  Publication,
  SubmittedLink,
} from '@entities/publication/model/publication.types';
import { ProjectReviewComponent } from '@widgets/project-review/project-review.component';

/**
 * Проверка ролика менеджером.
 *
 * Главное правило: принять нельзя, пока по каждому обязательному пункту
 * не стоит «да» ИМЕННО от менеджера. Отметка креатора здесь не считается
 * вовсе — иначе проверка проверяла бы сама себя, — а пункт, до которого
 * менеджер не дошёл, держит кнопку так же, как пункт с «нет»:
 * непроверенное не равно пройденному.
 *
 * Второе правило, которое легко потерять: спрашиваются только те пункты,
 * что относятся к сданным площадкам. Пункт про YouTube у ролика без
 * YouTube — это требование, которое невозможно выполнить.
 */
describe('ProjectReviewComponent: проверка ролика', () => {
  function link(over: Partial<SubmittedLink> = {}): SubmittedLink {
    return {
      id: over.id ?? 'l1',
      publication_id: 'p1',
      platform: over.platform ?? 'tiktok',
      url: over.url ?? 'https://www.tiktok.com/@u/video/1',
      url_canonical: over.url ?? 'https://www.tiktok.com/@u/video/1',
      submitted_at: over.submitted_at ?? '2026-09-16T10:00:00Z',
      ...over,
    } as SubmittedLink;
  }

  function pub(over: Partial<Publication> = {}): Publication {
    return {
      id: over.id ?? 'p1',
      project_id: 'pr1',
      creator_user_id: 'u1',
      creator_name: 'Паша Гром',
      due_date: '2026-09-16',
      status: 'partial',
      created_at: '2026-09-01T00:00:00Z',
      updated_at: '2026-09-16T10:00:00Z',
      links: [link()],
      overdue: false,
      views: 0,
      likes: 0,
      comments: 0,
      ...over,
    } as Publication;
  }

  function item(over: Partial<ChecklistItem> = {}): ChecklistItem {
    return {
      id: over.id ?? 'i1',
      project_id: 'pr1',
      text: over.text ?? 'Логотип в первые 3 секунды',
      is_required: over.is_required ?? true,
      sort_order: over.sort_order ?? 0,
      ...over,
    } as ChecklistItem;
  }

  function setup(pubs: Publication[], items: ChecklistItem[]) {
    TestBed.resetTestingModule();
    const api = jasmine.createSpyObj<PublicationApi>('pubApi', [
      'managerList',
      'managerChecklist',
      'managerReview',
    ]);
    api.managerList.and.returnValue(of({ items: pubs }) as never);
    api.managerChecklist.and.returnValue(of({ items }) as never);
    api.managerReview.and.callFake((id: string) =>
      of(pub({ id, review: { status: 'accepted', round: 1, marks: [] } })),
    );

    const msg = jasmine.createSpyObj<NzMessageService>('msg', ['success', 'error']);
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: PublicationApi, useValue: api },
        { provide: NzMessageService, useValue: msg },
      ],
    });
    TestBed.overrideComponent(ProjectReviewComponent, { set: { template: '' } });
    const fixture = TestBed.createComponent(ProjectReviewComponent);
    fixture.componentRef.setInput('projectId', 'pr1');
    fixture.detectChanges();
    return { cmp: fixture.componentInstance, api, msg, fixture };
  }

  it('в очередь попадают только сданные и непринятые ролики', () => {
    const { cmp } = setup(
      [
        pub({ id: 'planned', links: [] }),
        pub({ id: 'accepted', review: { status: 'accepted', round: 1, marks: [] } }),
        pub({ id: 'waiting' }),
      ],
      [item()],
    );
    expect(cmp.queue().map((p) => p.id)).toEqual(['waiting']);
    expect(cmp.current()?.id).toBe('waiting');
    expect(cmp.rest()).toBe(0);
  });

  it('первым проверяют то, что сдано раньше', () => {
    const { cmp } = setup(
      [
        pub({ id: 'late', links: [link({ submitted_at: '2026-09-18T10:00:00Z' })] }),
        pub({ id: 'early', links: [link({ submitted_at: '2026-09-14T10:00:00Z' })] }),
      ],
      [item()],
    );
    expect(cmp.current()?.id).toBe('early');
    expect(cmp.rest()).toBe(1);
  });

  it('непроверенный пункт держит «Принять» так же, как «нет»', () => {
    const { cmp } = setup([pub()], [item({ id: 'i1' }), item({ id: 'i2', text: 'Хэштеги' })]);
    expect(cmp.canAccept()).toBeFalse();

    cmp.setVerdict(item({ id: 'i1' }), true);
    // Второй пункт ещё не смотрели — принимать рано.
    expect(cmp.canAccept()).toBeFalse();

    cmp.setVerdict(item({ id: 'i2' }), false);
    expect(cmp.canAccept()).toBeFalse();

    cmp.setVerdict(item({ id: 'i2' }), true);
    expect(cmp.canAccept()).toBeTrue();
  });

  it('спрашиваются только пункты сданных площадок', () => {
    const { cmp } = setup(
      [pub({ links: [link({ platform: 'tiktok' })] })],
      [item({ id: 'i1' }), item({ id: 'yt', platform: 'youtube', text: 'Описание под роликом' })],
    );
    expect(cmp.items().map((i) => i.id)).toEqual(['i1']);
  });

  it('необязательные пункты в проверке не участвуют', () => {
    const { cmp } = setup([pub()], [item({ id: 'info', is_required: false })]);
    expect(cmp.items().length).toBe(0);
    // Спрашивать нечего — но и запрещать принятие незачем.
    expect(cmp.canAccept()).toBeTrue();
  });

  it('вердикты предыдущего решения подставляются в панель', () => {
    const { cmp } = setup(
      [
        pub({
          review: {
            status: 'returned',
            round: 2,
            comment: 'Логотипа не видно',
            marks: [{ item_id: 'i1', passed: false }],
          },
        }),
      ],
      [item({ id: 'i1' })],
    );
    expect(cmp.verdict(item({ id: 'i1' }))).toBeFalse();
    expect(cmp.comment()).toBe('Логотипа не видно');
  });

  /**
   * Возврат без слов — это отказ без причины: креатор всё равно придёт
   * выяснять, что не так, только уже в чате и на следующий день. Ручку
   * бэк тоже не пропустит, но ошибка в интерфейсе должна прийти раньше
   * запроса.
   */
  it('возврат без замечания не отправляется', () => {
    const { cmp, api, msg } = setup([pub()], [item()]);
    cmp.comment.set('   ');
    cmp.decide('return');
    expect(api.managerReview).not.toHaveBeenCalled();
    expect(msg.error).toHaveBeenCalled();
  });

  it('решение уходит вместе со всеми вердиктами', () => {
    const { cmp, api } = setup([pub()], [item({ id: 'i1' })]);
    cmp.setVerdict(item({ id: 'i1' }), true);
    cmp.comment.set('  Всё хорошо  ');
    cmp.decide('accept');

    const [pubId, marks, comment, decision] = api.managerReview.calls.mostRecent().args;
    expect(pubId).toBe('p1');
    expect(marks).toEqual([{ item_id: 'i1', passed: true }]);
    expect(comment).toBe('Всё хорошо');
    expect(decision).toBe('accept');
  });

  it('принятый ролик уходит из очереди', () => {
    const { cmp, api } = setup([pub()], [item({ id: 'i1' })]);
    cmp.setVerdict(item({ id: 'i1' }), true);
    cmp.decide('accept');
    expect(api.managerReview).toHaveBeenCalled();
    expect(cmp.queue().length).toBe(0);
    expect(cmp.current()).toBeNull();
  });
});
