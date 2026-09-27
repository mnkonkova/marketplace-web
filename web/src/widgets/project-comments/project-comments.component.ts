import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzMessageService } from 'ng-zorro-antd/message';

import { ProjectApi } from '@entities/project/api/project.api';
import { PublicationApi } from '@entities/publication/api/publication.api';
import {
  CommentInput,
  CommentParticipant,
  CommentThread,
  ProjectComment,
} from '@entities/project/model/project.types';
import { groupThreads, threadOf } from '@entities/project/lib/comment-threads';
import {
  editorBodyHtml,
  isEmptyBody,
  mentionHtml,
  renderCommentHtml,
} from '@entities/project/lib/comment-html';
import { parseApiError } from '@shared/api/api-error';

export type CommentsRole = 'client' | 'creator' | 'manager';

// Вкладка переписки. У клиента и креатора она одна и переключать нечего:
// какая ветка твоя, решает сервер. У менеджера их столько, сколько людей
// в проекте, плюс клиентская и внутренняя.
interface ThreadTab {
  key: string;
  thread: CommentThread;
  creatorId?: string;
  label: string;
  note: string;
}

interface CommentView {
  id: string;
  author: string;
  createdAt: string;
  internal: boolean;
  mine: boolean;
  html: SafeHtml;
}

// Переписка по проекту: три ветки, разделённые правом читать. Клиент
// говорит с менеджером, каждый креатор — с менеджером отдельно, внутренние
// заметки не видит ни тот, ни другой. Форматирование чистит сервер:
// остаются жирный, курсив, подчёркнутый, зачёркнутый, списки, ссылки и
// упоминания, всё прочее выбрасывается молча.
@Component({
  selector: 'app-project-comments',
  standalone: true,
  imports: [CommonModule, NzButtonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './project-comments.component.html',
  styleUrls: ['./project-comments.component.scss', './project-comments.component.touch.scss'],
})
export class ProjectCommentsComponent {
  private readonly api = inject(ProjectApi);

  private readonly pubApi = inject(PublicationApi);

  private readonly msg = inject(NzMessageService);

  private readonly sanitizer = inject(DomSanitizer);

  public readonly projectId = input.required<string>();

  public readonly role = input.required<CommentsRole>();

  // Свой id, чтобы отличить «Вы» от собеседника. Не обязателен: без него
  // просто не будет подписи «Вы».
  public readonly meId = input<string>('');

  private readonly editor = viewChild<ElementRef<HTMLElement>>('editor');

  public readonly loading = signal(true);

  public readonly sending = signal(false);

  public readonly all = signal<ProjectComment[]>([]);

  public readonly participants = signal<CommentParticipant[]>([]);

  // Состав проекта — только у менеджера: он даёт вкладки даже тем
  // креаторам, кто ещё ничего не написал.
  public readonly crew = signal<{ user_id: string; display_name: string }[]>([]);

  public readonly activeKey = signal('client');

  public readonly mentionOpen = signal(false);

  public constructor() {
    effect(() => {
      const id = this.projectId();
      const role = this.role();
      if (id) this.load(id, role);
    });
    // Участники зависят от выбранной ветки: упомянуть можно только того,
    // кто эту ветку читает. Сама ветка читается untracked — иначе список
    // перезапрашивался бы после каждого отправленного сообщения.
    effect(() => {
      const key = this.activeKey();
      const id = this.projectId();
      const tab = untracked(() => this.tabs().find((t) => t.key === key) ?? this.tabs()[0]);
      if (id && tab) this.loadParticipants(id, tab);
    });
  }

  public readonly tabs = computed<ThreadTab[]>(() => {
    if (this.role() === 'client') {
      return [
        {
          key: 'client',
          thread: 'client',
          label: 'Менеджеру',
          note: 'Креаторы этот чат не видят.',
        },
      ];
    }
    if (this.role() === 'creator') {
      return [
        {
          key: 'client',
          thread: 'client',
          label: 'Менеджеру',
          note: 'Ваша переписка с менеджером. Ни клиент, ни другие креаторы её не видят.',
        },
      ];
    }

    const grouped = groupThreads(this.all());
    const named = new Map<string, string>();
    for (const t of grouped.creators) if (t.name) named.set(t.creatorId, t.name);
    for (const c of this.crew()) if (c.display_name) named.set(c.user_id, c.display_name);
    // Ветка есть у каждого, кто в составе, и у каждой существующей ветки:
    // выбывший из проекта не исчезает из переписки.
    //
    // Идём по самим веткам, а не по именам: имя ветки заполняется только
    // из сообщения самого креатора. Ветка, где писал один менеджер, имени
    // не имеет — и выбывший из состава молчун терял вкладку вместе со
    // всей перепиской.
    const ids = [
      ...new Set([
        ...this.crew().map((c) => c.user_id),
        ...grouped.creators.map((t) => t.creatorId),
      ]),
    ];

    return [
      {
        key: 'client',
        thread: 'client' as const,
        label: 'С заказчиком',
        note: 'Клиентская ветка. Креаторы её не видят.',
      },
      ...ids.map((id) => ({
        key: `creator:${id}`,
        thread: 'creator' as const,
        creatorId: id,
        label: named.get(id) ?? 'Без имени',
        note: 'Личная ветка креатора. Ни клиент, ни другие креаторы её не видят.',
      })),
      {
        key: 'internal',
        thread: 'internal' as const,
        label: 'Только менеджерам',
        note: 'Внутренние заметки. Их не видит ни клиент, ни креатор.',
      },
    ];
  });

  public readonly activeTab = computed<ThreadTab | null>(() => {
    const tabs = this.tabs();
    return tabs.find((t) => t.key === this.activeKey()) ?? tabs[0] ?? null;
  });

  // Записи выбранной ветки. У клиента и креатора ручка и так отдаёт одну
  // ветку — фильтр в этом случае ничего не отсекает.
  public readonly visible = computed<CommentView[]>(() => {
    const tab = this.activeTab();
    if (!tab) return [];
    const me = this.meId();
    return this.all()
      .filter((c) => {
        if (this.role() !== 'manager') return true;
        if (threadOf(c) !== tab.thread) return false;
        return tab.thread !== 'creator' || c.thread_user_id === tab.creatorId;
      })
      .map((c) => ({
        id: c.id,
        author: c.author_name?.trim() || 'Без имени',
        createdAt: c.created_at,
        internal: threadOf(c) === 'internal',
        mine: !!me && c.author_id === me,
        html: this.sanitizer.bypassSecurityTrustHtml(
          c.body_format === 'html' ? renderCommentHtml(c.body) : escapePlain(c.body),
        ),
      }));
  });

  /**
   * Недописанные сообщения — по вкладке на каждое.
   *
   * Редактор один на все ветки, и переключение вкладки оставляло в нём
   * набранный текст: внутренняя заметка, написанная в «Только
   * менеджерам», уходила клиенту, если между набором и отправкой
   * заглянуть в клиентскую ветку. Черновик теперь переезжает не с
   * человеком, а с веткой, в которой его писали.
   */
  private readonly drafts = new Map<string, string>();

  public pick(tab: ThreadTab): void {
    const el = this.editor()?.nativeElement;
    if (el) {
      const from = this.activeKey();
      const draft = el.innerHTML;
      if (isEmptyBody(draft)) this.drafts.delete(from);
      else this.drafts.set(from, draft);
      el.innerHTML = this.drafts.get(tab.key) ?? '';
    }
    this.activeKey.set(tab.key);
    this.mentionOpen.set(false);
  }

  // ---- редактор ----

  // execCommand объявлен устаревшим, но это единственный способ дать
  // жирный и курсив на contenteditable без внешнего редактора. Разметку
  // после него всё равно приводим к белому списку сервера.
  public format(command: 'bold' | 'italic' | 'strikeThrough' | 'insertUnorderedList'): void {
    this.editor()?.nativeElement.focus();
    document.execCommand(command);
  }

  public toggleMentions(): void {
    if (!this.participants().length) {
      this.msg.info('В этой ветке некого упомянуть.');
      return;
    }
    this.mentionOpen.set(!this.mentionOpen());
  }

  // Упомянуть можно только участника ветки: постороннего сервер молча
  // развернёт — текст останется, уведомления не будет. Поэтому список
  // берём с сервера, а не составляем сами.
  public mention(p: CommentParticipant): void {
    const el = this.editor()?.nativeElement;
    if (!el) return;
    el.focus();
    document.execCommand('insertHTML', false, mentionHtml(p.user_id, p.display_name));
    this.mentionOpen.set(false);
  }

  public send(): void {
    const el = this.editor()?.nativeElement;
    const tab = this.activeTab();
    if (!el || !tab) return;
    const raw = el.innerHTML;
    if (isEmptyBody(raw)) {
      this.msg.error('Пустое сообщение отправить нельзя.');
      return;
    }
    const input: CommentInput = { body: editorBodyHtml(raw), body_format: 'html' };
    if (this.role() === 'manager') {
      input.thread = tab.thread;
      if (tab.thread === 'creator') input.creator_id = tab.creatorId;
    }

    this.sending.set(true);
    this.request(input).subscribe({
      next: (saved) => {
        this.sending.set(false);
        el.innerHTML = '';
        this.drafts.delete(tab.key);
        this.all.set([...this.all(), saved]);
        if (saved.mentions?.length) {
          this.msg.success(`Отправлено, уведомление ушло в бот: ${saved.mentions.length}.`);
        }
      },
      error: (e) => {
        this.sending.set(false);
        this.msg.error(parseApiError(e, 'Не удалось отправить сообщение.').message);
      },
    });
  }

  private request(input: CommentInput) {
    const id = this.projectId();
    if (this.role() === 'client') return this.api.clientCreateComment(id, input);
    if (this.role() === 'creator') return this.api.creatorCreateComment(id, input);
    return this.api.managerCreateComment(id, input);
  }

  private load(id: string, role: CommentsRole): void {
    this.loading.set(true);
    const list =
      role === 'client'
        ? this.api.clientListComments(id)
        : role === 'creator'
          ? this.api.creatorListComments(id)
          : this.api.managerListComments(id);
    list.subscribe({
      next: (r) => {
        this.all.set(r.items);
        this.loading.set(false);
      },
      error: (e) => {
        this.loading.set(false);
        this.msg.error(parseApiError(e, 'Не удалось загрузить переписку.').message);
      },
    });
    if (role === 'manager') {
      this.pubApi.managerCreators(id).subscribe({
        next: (r) =>
          this.crew.set(r.items.map((p) => ({ user_id: p.user_id, display_name: p.display_name }))),
        // Проект не про выкладки — веток креаторов у него и не будет.
        error: () => this.crew.set([]),
      });
    }
  }

  private loadParticipants(id: string, tab: ThreadTab): void {
    const role = this.role();
    const req =
      role === 'client'
        ? this.api.clientCommentParticipants(id)
        : role === 'creator'
          ? this.api.creatorCommentParticipants(id)
          : this.api.managerCommentParticipants(id, tab.thread, tab.creatorId);
    req.subscribe({
      next: (r) => this.participants.set(r.items),
      error: () => this.participants.set([]),
    });
  }
}

// Старые записи приходят plain-текстом. Через innerHTML их всё равно
// прогоняем, поэтому угловые скобки экранируем сами.
function escapePlain(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML.replace(/\n/g, '<br>');
}
