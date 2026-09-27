import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { NzMessageService } from 'ng-zorro-antd/message';

import { PublicationApi } from '@entities/publication/api/publication.api';
import { PLATFORM_LABEL, PLATFORM_SHORT } from '@entities/publication/lib/publication-status';
import type {
  Platform,
  ProjectPerson,
  Publication,
} from '@entities/publication/model/publication.types';
import { ALL_PLATFORMS } from '@entities/publication/model/publication.types';
import { parseApiError } from '@shared/api/api-error';
import { SotkaAvaComponent } from '@shared/ui/sotka-ava/sotka-ava.component';

/**
 * Все ссылки проекта — по креаторам.
 *
 * Править ссылку можно было только в проверке, а проверка показывает
 * ОДИН ролик: тот, что сейчас на очереди. Ролик, принятый месяц назад, в
 * неё уже не попадает — и когда он исчезает с площадки, менять адрес
 * менеджеру негде. Отсюда этот экран: все выкладки сразу, сгруппированы
 * по людям (спрашивают всегда про человека — «что там у Ани»), и у
 * каждой площадки свой адрес под рукой.
 *
 * Пустая площадка тоже правится: креатор прислал ссылку в переписку, и
 * перенести её — дело одной строки, а не просьбы «сдай ещё раз».
 */
@Component({
  selector: 'app-project-links',
  standalone: true,
  imports: [CommonModule, FormsModule, SotkaAvaComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './project-links.component.html',
  styleUrl: './project-links.component.scss',
})
export class ProjectLinksComponent {
  private readonly api = inject(PublicationApi);

  private readonly msg = inject(NzMessageService);

  public readonly creators = input<readonly ProjectPerson[]>([]);

  public readonly publications = input<readonly Publication[]>([]);

  /** Ссылка заменена — странице надо перечитать выкладки. */
  public readonly changed = output<void>();

  public readonly platforms = ALL_PLATFORMS;

  public readonly platformShort = PLATFORM_SHORT;

  public readonly platformLabel = PLATFORM_LABEL;

  /** Кто раскрыт. По умолчанию все свёрнуты: людей бывает восемь. */
  public readonly open = signal<string>('');

  public toggle(userID: string): void {
    this.open.set(this.open() === userID ? '' : userID);
  }

  /**
   * Выкладки по людям, свежие сверху.
   *
   * Сверху свежие, потому что меняют адрес почти всегда у недавнего: у
   * ролика, который сняли с площадки на этой неделе. Архив листают
   * редко и сознательно.
   */
  public readonly groups = computed(() => {
    const live = this.publications().filter((p) => p.status !== 'cancelled');
    return this.creators().map((person) => {
      const mine = live
        .filter((p) => p.creator_user_id === person.user_id)
        .sort((a, b) =>
          (b.published_at ?? b.due_date).localeCompare(a.published_at ?? a.due_date),
        );
      return {
        person,
        pubs: mine,
        // «Сдано ссылок» считаем по обязательной пятёрке: наследная
        // площадка в знаменатель не идёт, иначе полный ролик выглядел
        // бы недосданным.
        links: mine.reduce(
          (n, p) => n + p.links.filter((l) => this.platforms.includes(l.platform)).length,
          0,
        ),
        total: mine.length * this.platforms.length,
      };
    });
  });

  public link(pub: Publication, platform: Platform) {
    return pub.links.find((l) => l.platform === platform);
  }

  // ---- правка ----

  /** Какую площадку какого ролика правим: «<id>|<platform>». */
  public readonly editing = signal<string>('');

  public editUrl = '';

  public readonly busy = signal(false);

  public isEditing(pub: Publication, platform: Platform): boolean {
    return this.editing() === `${pub.id}|${platform}`;
  }

  public startEdit(pub: Publication, platform: Platform): void {
    if (this.isEditing(pub, platform)) {
      this.editing.set('');
      return;
    }
    // Подставляем текущий адрес: чаще правят его, а не вставляют с нуля.
    this.editUrl = this.link(pub, platform)?.url ?? '';
    this.editing.set(`${pub.id}|${platform}`);
  }

  public save(pub: Publication, platform: Platform): void {
    const url = this.editUrl.trim();
    if (!url || this.busy()) return;
    this.busy.set(true);
    this.api.managerEditLink(pub.id, platform, url).subscribe({
      next: () => {
        this.busy.set(false);
        this.editing.set('');
        this.msg.success('Ссылка заменена.');
        this.changed.emit();
      },
      error: (e) => {
        this.busy.set(false);
        this.msg.error(parseApiError(e, 'Не удалось заменить ссылку.').message);
      },
    });
  }
}
