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

  /**
   * ВОЗВРАЩЁННЫЙ РОЛИК ЖДЁТ КРЕАТОРА, А НЕ МЕНЕДЖЕРА.
   *
   * Он сдан и не принят, поэтому в прежнем условии оставался в очереди —
   * и, как самый давно сданный, вставал в ней первым. Менеджер нажимал
   * «Вернуть» и видел тот же ролик снова, а второй, действительно
   * ждущий проверки, был недостижим, пока первый не пересдадут.
   *
   * Когда креатор пересдаёт, сервер сам открывает проверку заново
   * (status → in_review), и ролик возвращается в очередь.
   */
  it('возвращённый ролик уходит из очереди и не запирает следующий', () => {
    const { cmp } = setup(
      [
        pub({
          id: 'returned',
          links: [link({ submitted_at: '2026-09-10T10:00:00Z' })],
          review: { status: 'returned', round: 1, comment: 'Перемонтируй начало', marks: [] },
        }),
        pub({ id: 'waiting', links: [link({ submitted_at: '2026-09-16T10:00:00Z' })] }),
      ],
      [item()],
    );
    expect(cmp.queue().map((p) => p.id)).toEqual(['waiting']);
    expect(cmp.current()?.id)
      .withContext('первым открылся возвращённый — очередь заперта')
      .toBe('waiting');
    // Со экрана он при этом не исчезает: это работа, которая стоит.
    expect(cmp.returned().map((p) => p.id)).toEqual(['returned']);
  });

  /**
   * Вернули — и следующий открылся сам. Раньше на экране оставался тот
   * же ролик, и единственным следом действия был всплывающий тост.
   */
  it('после возврата открывается следующий ролик очереди', () => {
    const { cmp, api } = setup(
      [
        pub({ id: 'first', links: [link({ submitted_at: '2026-09-14T10:00:00Z' })] }),
        pub({ id: 'second', links: [link({ submitted_at: '2026-09-16T10:00:00Z' })] }),
      ],
      [item()],
    );
    expect(cmp.current()?.id).toBe('first');

    api.managerReview.and.returnValue(
      of(
        pub({
          id: 'first',
          links: [link({ submitted_at: '2026-09-14T10:00:00Z' })],
          review: { status: 'returned', round: 1, comment: 'Логотипа нет', marks: [] },
        }),
      ) as never,
    );
    cmp.comment.set('Логотипа нет');
    cmp.decide('return');

    expect(cmp.current()?.id)
      .withContext('менеджер вернул ролик и снова видит его же')
      .toBe('second');
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

  /**
   * Ролик смотрят частями: отметил два пункта, отвлёкся, вернулся.
   * Сохранённый ход проверки (решение не вынесено, status in_review)
   * обязан подставиться обратно — иначе на третий заход человек
   * отмечает всё заново.
   */
  it('сохранённый ход проверки подставляется в панель', () => {
    const { cmp } = setup(
      [
        pub({
          review: {
            status: 'in_review',
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

/**
 * Куда ведёт плитка ролика.
 *
 * Площадку выбираем мы, а не порядок строк в базе: смотреть присланное
 * удобнее там, где ролик открывается страницей с плеером, а не лентой,
 * которая тут же уносит в следующий.
 */
describe('ProjectReviewComponent: где смотреть ролик', () => {
  function link(platform: string, id: string): SubmittedLink {
    return {
      id,
      publication_id: 'p1',
      platform,
      url: `https://${platform}.example/${id}`,
      url_canonical: `https://${platform}.example/${id}`,
      submitted_at: '2026-09-16T10:00:00Z',
    } as SubmittedLink;
  }

  function setup(links: SubmittedLink[]) {
    TestBed.resetTestingModule();
    const api = jasmine.createSpyObj<PublicationApi>('pubApi', [
      'managerList',
      'managerChecklist',
      'managerReview',
    ]);
    api.managerList.and.returnValue(
      of({
        items: [
          {
            id: 'p1',
            project_id: 'pr1',
            creator_user_id: 'u1',
            creator_name: 'Паша',
            due_date: '2026-09-16',
            status: 'partial',
            created_at: '2026-09-01T00:00:00Z',
            updated_at: '2026-09-16T10:00:00Z',
            links,
            overdue: false,
            views: 0,
            likes: 0,
            comments: 0,
          },
        ],
      }) as never,
    );
    api.managerChecklist.and.returnValue(of({ items: [] }) as never);
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: PublicationApi, useValue: api },
        { provide: NzMessageService, useValue: jasmine.createSpyObj('msg', ['success', 'error']) },
      ],
    });
    TestBed.overrideComponent(ProjectReviewComponent, { set: { template: '' } });
    const f = TestBed.createComponent(ProjectReviewComponent);
    f.componentRef.setInput('projectId', 'pr1');
    f.detectChanges();
    return f.componentInstance;
  }

  it('есть YouTube — ведём туда, хотя в базе он не первый', () => {
    const cmp = setup([link('tiktok', 'a'), link('vk', 'b'), link('youtube', 'c')]);
    expect(cmp.watchUrl()).toBe('https://youtube.example/c');
    expect(cmp.watchOn()).toBe('Shorts');
  });

  it('YouTube нет — следующий Reels', () => {
    const cmp = setup([link('vk', 'a'), link('instagram', 'b'), link('tiktok', 'c')]);
    expect(cmp.watchUrl()).toBe('https://instagram.example/b');
  });

  it('ни того, ни другого — TikTok', () => {
    const cmp = setup([link('likee', 'a'), link('tiktok', 'b')]);
    expect(cmp.watchUrl()).toBe('https://tiktok.example/b');
  });

  /**
   * Ничего из тройки нет — порядок продолжается: VK Клипы, потом
   * Likee. Пустой плитки не бывает: ролик где-то лежит, и открыть его
   * надо хоть где.
   */
  it('остались только прочие площадки — порядок продолжается', () => {
    const cmp = setup([link('likee', 'a'), link('vk', 'b')]);
    expect(cmp.watchUrl()).toBe('https://vk.example/b');
  });
});

/**
 * Правка ссылки прямо в проверке.
 *
 * Ролик удаляют с площадки, креатор присылает новый адрес — и до сих пор
 * перенести его было некуда: правка жила на старом экране выкладок,
 * которого у проектов «креаторы под ключ» нет вовсе.
 */
describe('ProjectReviewComponent: правка ссылки', () => {
  function link(platform: string, id: string): SubmittedLink {
    return {
      id,
      publication_id: 'p1',
      platform,
      url: `https://${platform}.example/${id}`,
      url_canonical: `https://${platform}.example/${id}`,
      submitted_at: '2026-09-16T10:00:00Z',
    } as SubmittedLink;
  }

  function setup() {
    TestBed.resetTestingModule();
    const api = jasmine.createSpyObj<PublicationApi>('pubApi', [
      'managerList',
      'managerChecklist',
      'managerReview',
      'managerEditLink',
    ]);
    api.managerList.and.returnValue(
      of({
        items: [
          {
            id: 'p1',
            project_id: 'pr1',
            creator_user_id: 'u1',
            due_date: '2026-09-16',
            status: 'partial',
            created_at: '2026-09-01T00:00:00Z',
            updated_at: '2026-09-16T10:00:00Z',
            links: [link('tiktok', 'a'), link('youtube', 'b')],
            overdue: false,
            views: 0,
            likes: 0,
            comments: 0,
          },
        ],
      }) as never,
    );
    api.managerChecklist.and.returnValue(of({ items: [] }) as never);
    api.managerEditLink.and.returnValue(of({ id: 'p1', links: [] }) as never);
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: PublicationApi, useValue: api },
        { provide: NzMessageService, useValue: jasmine.createSpyObj('msg', ['success', 'error']) },
      ],
    });
    TestBed.overrideComponent(ProjectReviewComponent, { set: { template: '' } });
    const f = TestBed.createComponent(ProjectReviewComponent);
    f.componentRef.setInput('projectId', 'pr1');
    f.detectChanges();
    return { cmp: f.componentInstance, api };
  }

  it('ссылки идут в порядке просмотра, а не как легли в базе', () => {
    const { cmp } = setup();
    expect(cmp.links().map((l) => l.platform)).toEqual(['youtube', 'tiktok']);
  });

  it('правка подставляет текущий адрес — его чаще чинят, чем вставляют заново', () => {
    const { cmp } = setup();
    cmp.startEdit({ platform: 'tiktok', url: 'https://tiktok.example/a' });
    expect(cmp.editing()).toBe('tiktok');
    expect(cmp.editUrl()).toBe('https://tiktok.example/a');
  });

  it('сохранение шлёт новый адрес и закрывает правку', () => {
    const { cmp, api } = setup();
    cmp.startEdit({ platform: 'tiktok', url: 'https://tiktok.example/a' });
    cmp.editUrl.set('https://tiktok.example/new');
    cmp.saveLink('tiktok');
    expect(api.managerEditLink).toHaveBeenCalledWith('p1', 'tiktok', 'https://tiktok.example/new');
    expect(cmp.editing()).toBeNull();
  });

  it('пустой адрес не отправляется: снять площадку — не то же, что заменить', () => {
    const { cmp, api } = setup();
    cmp.startEdit({ platform: 'tiktok', url: 'https://tiktok.example/a' });
    cmp.editUrl.set('   ');
    cmp.saveLink('tiktok');
    expect(api.managerEditLink).not.toHaveBeenCalled();
  });
});
