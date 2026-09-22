import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { NzMessageService } from 'ng-zorro-antd/message';

import { PublicationApi } from '@entities/publication/api/publication.api';
import { PLATFORM_LABEL } from '@entities/publication/lib/publication-status';
import { videoCoverUrl } from '@entities/publication/lib/video-cover';
import type {
  ChecklistItem,
  Platform,
  Publication,
  ReviewDecision,
  ReviewMark,
} from '@entities/publication/model/publication.types';
import { parseApiError } from '@shared/api/api-error';

/**
 * Проверка ролика.
 *
 * Чек-лист до сих пор был односторонним: креатор отмечал пункты сам,
 * сервер не давал сдать с непройденными обязательными — и на этом всё
 * кончалось. Посмотрел ли кто-нибудь ролик и что с ним не так, нигде не
 * хранилось, а «перемонтируй начало» жило в переписке.
 *
 * Здесь появляется вторая сторона. По каждому обязательному пункту
 * менеджер ставит «да» или «нет» своим именем, пишет замечание и либо
 * возвращает ролик, либо принимает. Принять нельзя, пока хоть один
 * пункт не закрыт, — и держит это правило сервер, а не гашёная кнопка.
 *
 * Показывается ОДИН ролик — тот, что ждёт дольше всех. Очередь вся
 * сразу не нужна: проверяют по одному, а число ждущих сказано словами.
 */
@Component({
  selector: 'app-project-review',
  standalone: true,
  imports: [CommonModule, FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './project-review.component.html',
  styleUrls: ['./project-review.component.scss', './project-review.component.touch.scss'],
})
export class ProjectReviewComponent {
  private readonly api = inject(PublicationApi);
  private readonly msg = inject(NzMessageService);

  public readonly projectId = input.required<string>();

  public readonly platformLabel = PLATFORM_LABEL;

  public readonly pubs = signal<Publication[]>([]);

  public readonly checklist = signal<ChecklistItem[]>([]);

  public readonly loading = signal(true);

  public readonly busy = signal(false);

  /**
   * Вердикты текущего ролика: пункт → «да»/«нет».
   *
   * Пункта без ключа менеджер не касался, и это третье состояние —
   * «ещё не смотрел». Оно не равно «нет», хотя принять не даёт так же:
   * непроверенное — не пройденное.
   */
  public readonly verdicts = signal<Record<string, boolean>>({});

  public readonly comment = signal('');

  public constructor() {
    effect(() => {
      const id = this.projectId();
      if (id) this.load(id);
    });

    // Сменился ролик — подставляем то, что по нему уже решено. Вердикты
    // прошлой проверки сервер стирает при пересдаче сам: они относились
    // к другому ролику.
    effect(() => {
      const pub = this.current();
      const marks: Record<string, boolean> = {};
      for (const m of pub?.review?.marks ?? []) marks[m.item_id] = m.passed;
      this.verdicts.set(marks);
      this.comment.set(pub?.review?.comment ?? '');
    });
  }

  private load(projectId: string): void {
    this.loading.set(true);
    this.api.managerList(projectId).subscribe({
      next: (r) => {
        this.pubs.set(r.items);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
    this.api.managerChecklist(projectId).subscribe({
      next: (r) => this.checklist.set(r.items),
    });
  }

  /**
   * Очередь на проверку: сданные ролики, по которым нет «принято».
   *
   * Сначала возвращённые — по ним креатор уже переснял, и ждут они
   * дольше всех, — потом по дате сдачи.
   */
  public readonly queue = computed<Publication[]>(() =>
    this.pubs()
      .filter((p) => p.links.length > 0 && p.review?.status !== 'accepted')
      .sort((a, b) => this.submittedAt(a).localeCompare(this.submittedAt(b))),
  );

  private submittedAt(pub: Publication): string {
    return pub.links.map((l) => l.submitted_at).sort()[0] ?? pub.due_date;
  }

  public readonly current = computed<Publication | null>(() => this.queue()[0] ?? null);

  /** Сколько ещё ждёт за текущим. */
  public readonly rest = computed(() => Math.max(0, this.queue().length - 1));

  /**
   * Пункты, которые проверяют: обязательные и относящиеся к сданным
   * площадкам. Пункт про YouTube не спрашивают у ролика, которого на
   * YouTube нет, — ровно то же правило работает у креатора при сдаче.
   */
  public readonly items = computed<ChecklistItem[]>(() => {
    const pub = this.current();
    if (!pub) return [];
    const has = new Set(pub.links.map((l) => l.platform));
    return this.checklist().filter((i) => i.is_required && (!i.platform || has.has(i.platform)));
  });

  public verdict(item: ChecklistItem): boolean | null {
    const v = this.verdicts()[item.id];
    return v === undefined ? null : v;
  }

  public setVerdict(item: ChecklistItem, passed: boolean): void {
    this.verdicts.update((m) => ({ ...m, [item.id]: passed }));
  }

  /** Принять можно, когда каждый спрашиваемый пункт закрыт. */
  public readonly canAccept = computed(() =>
    this.items().every((i) => this.verdicts()[i.id] === true),
  );

  /** Обложка ролика — настоящий кадр, если он есть у площадки. */
  public readonly cover = computed(() => {
    const pub = this.current();
    return pub ? videoCoverUrl(pub.links.map((l) => l.url)) : null;
  });

  public readonly platforms = computed<Platform[]>(() =>
    (this.current()?.links ?? []).map((l) => l.platform),
  );

  /** Куда ведёт плитка: на сам ролик, а не на пустой плеер. */
  public readonly watchUrl = computed(() => this.current()?.links[0]?.url ?? null);

  public submittedOn(pub: Publication): string {
    const iso = this.submittedAt(pub);
    const d = new Date(iso);
    return Number.isNaN(d.getTime())
      ? ''
      : d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' });
  }

  public decide(decision: Exclude<ReviewDecision, ''>): void {
    const pub = this.current();
    if (!pub || this.busy()) return;
    const comment = this.comment().trim();
    if (decision === 'return' && !comment) {
      // Возврат без слов — отказ без причины: креатор всё равно придёт
      // спрашивать, что не так.
      this.msg.error('Напишите, что переделать: возврат без замечания креатору бесполезен.');
      return;
    }
    const marks: ReviewMark[] = Object.entries(this.verdicts()).map(([item_id, passed]) => ({
      item_id,
      passed,
    }));

    this.busy.set(true);
    this.api.managerReview(pub.id, marks, comment, decision).subscribe({
      next: (updated) => {
        this.busy.set(false);
        this.pubs.update((list) => list.map((p) => (p.id === updated.id ? updated : p)));
        this.msg.success(
          decision === 'accept'
            ? 'Ролик принят.'
            : 'Вернули креатору с замечанием — он увидит его в своём кабинете.',
        );
      },
      error: (e: unknown) => {
        this.busy.set(false);
        this.msg.error(parseApiError(e, 'Не удалось сохранить проверку.').message);
      },
    });
  }
}
