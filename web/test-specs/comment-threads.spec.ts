import {
  commentPreview,
  groupThreads,
  mentionedNames,
  threadOf,
} from '@entities/project/lib/comment-threads';
import {
  editorBodyHtml,
  htmlToText,
  isEmptyBody,
  mentionHtml,
  renderCommentHtml,
} from '@entities/project/lib/comment-html';
import { ProjectComment } from '@entities/project/model/project.types';

function comment(over: Partial<ProjectComment> = {}): ProjectComment {
  return {
    id: 'c1',
    project_id: 'pr1',
    author_id: 'u1',
    author_name: 'Мария',
    body: 'текст',
    body_format: 'plain',
    is_internal: false,
    created_at: '2026-08-25T14:32:00Z',
    updated_at: '2026-08-25T14:32:00Z',
    ...over,
  };
}

describe('threadOf: какая это ветка', () => {
  it('явное поле thread выигрывает', () => {
    expect(threadOf(comment({ thread: 'creator', thread_user_id: 'u9' }))).toBe('creator');
    expect(threadOf(comment({ thread: 'internal' }))).toBe('internal');
    expect(threadOf(comment({ thread: 'client' }))).toBe('client');
  });

  it('запись без thread разбирается по старому is_internal', () => {
    expect(threadOf(comment({ is_internal: true }))).toBe('internal');
    expect(threadOf(comment({ is_internal: false }))).toBe('client');
  });

  it('неизвестное значение считается внутренним, а не клиентским', () => {
    // Ошибка в эту сторону прячет заметку от клиента; в обратную —
    // показывает ему внутреннюю кухню.
    const odd = comment({ thread: 'staff' as never, is_internal: true });
    expect(threadOf(odd)).toBe('internal');
  });
});

describe('groupThreads: разбор общей выдачи менеджера', () => {
  const items = [
    comment({ id: '1', thread: 'client', body: 'вопрос клиента' }),
    comment({ id: '2', thread: 'internal', is_internal: true, body: 'заметка' }),
    comment({
      id: '3',
      thread: 'creator',
      thread_user_id: 'anastasia',
      author_id: 'anastasia',
      author_name: 'Анастасия',
      body: 'снимаем в четверг',
    }),
    comment({
      id: '4',
      thread: 'creator',
      thread_user_id: 'andrey',
      author_id: 'manager',
      author_name: 'Мария',
      body: 'дозалей в Reels',
    }),
    comment({
      id: '5',
      thread: 'creator',
      thread_user_id: 'anastasia',
      author_id: 'manager',
      author_name: 'Мария',
      body: 'ок',
    }),
  ];

  it('клиентская и внутренняя ветки не смешиваются', () => {
    const g = groupThreads(items);
    expect(g.client.map((c) => c.id)).toEqual(['1']);
    expect(g.internal.map((c) => c.id)).toEqual(['2']);
  });

  it('у каждого креатора своя ветка, порядок — по первому сообщению', () => {
    const g = groupThreads(items);
    expect(g.creators.map((t) => t.creatorId)).toEqual(['anastasia', 'andrey']);
    expect(g.creators[0].items.map((c) => c.id)).toEqual(['3', '5']);
    expect(g.creators[1].items.map((c) => c.id)).toEqual(['4']);
  });

  it('имя ветки берётся из сообщения самого креатора, а не менеджера', () => {
    const g = groupThreads(items);
    expect(g.creators[0].name).toBe('Анастасия');
    // В ветке Андрея писал только менеджер — имени взять неоткуда.
    expect(g.creators[1].name).toBe('');
  });

  it('креаторская запись без thread_user_id никуда не попадает', () => {
    // Адресовать её некому: показать в чужой ветке хуже, чем не показать.
    const g = groupThreads([comment({ id: '9', thread: 'creator' })]);
    expect(g.creators.length).toBe(0);
    expect(g.client.length).toBe(0);
    expect(g.internal.length).toBe(0);
  });

  it('старая выдача без thread раскладывается на клиентскую и внутреннюю', () => {
    const g = groupThreads([
      comment({ id: 'a', is_internal: false }),
      comment({ id: 'b', is_internal: true }),
    ]);
    expect(g.client.map((c) => c.id)).toEqual(['a']);
    expect(g.internal.map((c) => c.id)).toEqual(['b']);
  });
});

describe('commentPreview', () => {
  it('у html-записи берётся body_text, а не разметка', () => {
    const c = comment({
      body_format: 'html',
      body: '<p><strong>Ролик</strong> вышел</p>',
      body_text: 'Ролик вышел',
    });
    expect(commentPreview(c)).toBe('Ролик вышел');
  });

  it('без body_text превью пустое, а не с тегами', () => {
    const c = comment({ body_format: 'html', body: '<p>привет</p>' });
    expect(commentPreview(c)).toBe('');
  });

  it('длинный текст обрезается многоточием', () => {
    const c = comment({ body: 'а'.repeat(200) });
    expect(commentPreview(c, 10).length).toBe(10);
    expect(commentPreview(c, 10).endsWith('…')).toBeTrue();
  });
});

describe('mentionedNames', () => {
  it('переводит id из mentions в имена участников', () => {
    const c = comment({ mentions: ['u2', 'u3'] });
    const names = new Map([
      ['u2', 'Андрей'],
      ['u3', 'Мария'],
    ]);
    expect(mentionedNames(c, names)).toEqual(['Андрей', 'Мария']);
  });

  it('без упоминаний — пусто', () => {
    expect(mentionedNames(comment(), new Map())).toEqual([]);
  });
});

describe('renderCommentHtml: белый список разметки', () => {
  it('оставляет теги, которые сервер разрешает', () => {
    const html = renderCommentHtml('<p><strong>жир</strong> и <em>курсив</em></p>');
    expect(html).toBe('<p><strong>жир</strong> и <em>курсив</em></p>');
  });

  it('чужой тег теряет обёртку, но текст остаётся', () => {
    expect(renderCommentHtml('<h1>заголовок</h1>')).toBe('заголовок');
  });

  it('скрипт не доезжает до разметки', () => {
    const html = renderCommentHtml('<p>до<script>alert(1)</script>после</p>');
    expect(html).not.toContain('<script');
    expect(htmlToText(html)).toContain('до');
  });

  it('упоминание становится подсвеченным span-ом без data-атрибута', () => {
    // Ангуляровский санитайзер вырезает data-*, поэтому подсветку
    // перекладываем в class на нашей стороне.
    const html = renderCommentHtml('<span data-mention-user-id="u2">@Андрей</span>');
    expect(html).toContain('class="mention"');
    expect(html).not.toContain('data-mention-user-id');
    expect(html).toContain('@Андрей');
  });

  it('span без упоминания не выживает как обёртка', () => {
    expect(renderCommentHtml('<span style="color:red">текст</span>')).toBe('текст');
  });

  it('ссылка уходит в новую вкладку, javascript: остаётся текстом', () => {
    const ok = renderCommentHtml('<a href="https://example.com">тут</a>');
    expect(ok).toContain('target="_blank"');
    expect(ok).toContain('rel="noopener noreferrer"');
    const bad = renderCommentHtml('<a href="javascript:alert(1)">тут</a>');
    expect(bad).toBe('тут');
  });
});

describe('editorBodyHtml: что уходит на сервер', () => {
  it('execCommand-теги приводятся к тем, что понимает сервер', () => {
    expect(editorBodyHtml('<b>жир</b><i>курсив</i>')).toBe('<strong>жир</strong><em>курсив</em>');
  });

  it('div от contenteditable становится абзацем', () => {
    expect(editorBodyHtml('<div>строка</div>')).toBe('<p>строка</p>');
  });

  it('упоминание сохраняет машинный атрибут — иначе уведомления не будет', () => {
    const body = editorBodyHtml(mentionHtml('u2', 'Андрей'));
    expect(body).toContain('data-mention-user-id="u2"');
    expect(body).toContain('@Андрей');
  });

  it('оформление вставки из буфера отбрасывается', () => {
    expect(editorBodyHtml('<p style="font-size:40px" class="x">текст</p>')).toBe('<p>текст</p>');
  });
});

describe('isEmptyBody', () => {
  it('пустой редактор пуст даже с <p><br></p>', () => {
    expect(isEmptyBody('<p><br></p>')).toBeTrue();
    expect(isEmptyBody('&nbsp;')).toBeTrue();
    expect(isEmptyBody('')).toBeTrue();
  });

  it('одно упоминание — уже не пусто', () => {
    expect(isEmptyBody(mentionHtml('u2', 'Андрей'))).toBeFalse();
  });
});
