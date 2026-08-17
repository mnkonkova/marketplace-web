import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { PortfolioItem } from '@entities/specialist/model/specialist.types';
import { formatDuration } from '@shared/lib/format';
import {
  orientationOf,
  parseAspectRatio,
  posterSrc,
  ratioFromElement,
} from '@shared/lib/portfolio-media';

/**
 * Флагман — закреплённая специалистом промо-работа над лентой.
 *
 * Вертикальный ролик (9:16) не растягиваем на всю ширину и не обрезаем: он
 * стоит плеером слева, а широкий контейнер заполняет тот же кадр, размытый
 * и притемнённый. Так нет ни чёрных полос, ни кропа.
 *
 * Горизонтальная работа (или смонтированный шоурил) в подложке не нуждается —
 * становится баннером 16:9 во всю ширину.
 */
@Component({
  selector: 'app-portfolio-flagship',
  standalone: true,
  imports: [NzButtonModule, NzIconModule],
  templateUrl: './portfolio-flagship.component.html',
  styleUrl: './portfolio-flagship.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PortfolioFlagshipComponent {
  public readonly item = input.required<PortfolioItem>();

  public readonly categoryTitles = input<Record<string, string>>({});

  /** «Смотреть» / клик по кадру — родитель открывает лайтбокс. */
  public readonly open = output<void>();

  /** Формат, измеренный на клиенте, если бэк не отдал aspect. */
  private readonly measured = signal<number | null>(null);

  private readonly broken = signal(false);

  public readonly poster = computed(() => posterSrc(this.item()));

  public readonly ratio = computed(() => parseAspectRatio(this.item().aspect) ?? this.measured());

  /**
   * Пока формат неизвестен, показываем вертикальную раскладку: в портфолио
   * это большинство, и она же безопаснее — вертикальный кадр в широком
   * баннере смотрелся бы обрезанным, а не наоборот.
   */
  public readonly isLandscape = computed(() => orientationOf(this.ratio()) === 'horizontal');

  public readonly aspectStyle = computed(() => {
    const r = this.ratio();
    return r == null ? '9 / 16' : `${r}`;
  });

  public readonly duration = computed(() => formatDuration(this.item().duration_sec));

  public readonly tags = computed(() => {
    const titles = this.categoryTitles();
    return (this.item().category_codes ?? []).slice(0, 3).map((c) => titles[c] ?? c);
  });

  public readonly isBroken = computed(() => this.broken());

  public measure(ev: Event): void {
    const el = ev.target as HTMLVideoElement | HTMLImageElement | null;
    if (!el) return;
    const ratio = ratioFromElement(el);
    if (ratio != null) this.measured.set(ratio);
  }

  public markBroken(): void {
    this.broken.set(true);
  }
}
