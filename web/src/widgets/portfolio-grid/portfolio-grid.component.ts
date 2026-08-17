import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { PortfolioItem } from '@entities/specialist/model/specialist.types';
import { formatDuration } from '@shared/lib/format';
import { MeasureAspectDirective } from '@shared/ui/measure-aspect.directive';
import {
  aspectLabel,
  aspectRatioCss,
  hoverPreview,
  orientationOf,
  knownRatio,
  posterSrc,
} from '@shared/lib/portfolio-media';

/**
 * Лента работ в 2 колонки со смешанными форматами. Каждая работа — в родном
 * аспекте (9:16 / 16:9 / 1:1), без кропа и чёрных полей.
 *
 * Раскладка — CSS-masonry (`columns: 2`): произвольные высоты укладываются
 * без дыр и без JS. Плата за это — порядок идёт по колонкам сверху-вниз, а
 * не строго слева-направо. Для портфолио это приемлемо: работы
 * просматривают целиком, а не читают как список новостей.
 */
@Component({
  selector: 'app-portfolio-grid',
  standalone: true,
  imports: [NzIconModule, MeasureAspectDirective],
  templateUrl: './portfolio-grid.component.html',
  styleUrl: './portfolio-grid.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PortfolioGridComponent {
  public readonly items = input<PortfolioItem[]>([]);

  /** Map<category_code, title> — чтобы чип показывал название, а не код. */
  public readonly categoryTitles = input<Record<string, string>>({});

  /** Клик по плитке. Индекс — в переданном массиве items. */
  public readonly open = output<number>();

  /**
   * Форматы, измеренные на клиенте для записей без aspect с бэка (старые
   * загрузки до ffprobe). Ключ — id работы.
   */
  private readonly measured = signal<Record<string, number>>({});

  /** Работа под курсором — для короткого автоплея. */
  public readonly hovered = signal<string | null>(null);

  /** Медиа, которые не загрузились: рисуем плейсхолдер вместо чёрного. */
  private readonly broken = signal<Record<string, true>>({});

  /**
   * Автоплей по hover'у только там, где есть настоящий курсор. На тачах
   * hover «залипает» после тапа, и превью играло бы на случайной плитке.
   */
  public readonly canHover = signal(
    typeof window !== 'undefined' && window.matchMedia('(hover: hover)').matches,
  );

  public readonly posterSrc = posterSrc;

  public readonly hoverPreview = hoverPreview;

  public readonly count = computed(() => this.items().length);

  public ratio(item: PortfolioItem): number | null {
    return knownRatio(item) ?? this.measured()[item.id] ?? null;
  }

  public aspectStyle(item: PortfolioItem): string {
    return aspectRatioCss(this.ratio(item));
  }

  public formatBadge(item: PortfolioItem): string {
    return aspectLabel(this.ratio(item));
  }

  public orientation(item: PortfolioItem): string {
    return orientationOf(this.ratio(item));
  }

  public durationBadge(item: PortfolioItem): string {
    return formatDuration(item.duration_sec);
  }

  /**
   * Подпись плитки. Название работы, а если специалист его не заполнил —
   * формат или тип медиа. Пустой подписи быть не должно: на тёмной обложке
   * плитка без текста выглядит как случайная кнопка ▶ на чёрном поле.
   */
  public caption(item: PortfolioItem): string {
    const title = item.title?.trim();
    if (title) return title;
    return this.formatBadge(item) || (item.kind === 'image' ? 'Фото-кейс' : 'Видео');
  }

  /** Название заполнено — подпись выводим обычным, а не приглушённым. */
  public hasTitle(item: PortfolioItem): boolean {
    return !!item.title?.trim();
  }

  /** До трёх тегов самой работы — не глобальная роль специалиста. */
  public tags(item: PortfolioItem): string[] {
    const titles = this.categoryTitles();
    return (item.category_codes ?? []).slice(0, 3).map((c) => titles[c] ?? c);
  }

  public isBroken(item: PortfolioItem): boolean {
    return !!this.broken()[item.id];
  }

  public markBroken(item: PortfolioItem): void {
    this.broken.update((m) => ({ ...m, [item.id]: true }));
  }

  /**
   * Формат, измеренный на клиенте. Постер — кадр того же ролика, поэтому
   * его natural-размеры дают аспект видео без загрузки метаданных самого
   * видео.
   */
  public setRatio(item: PortfolioItem, ratio: number): void {
    if (this.measured()[item.id] === ratio) return;
    this.measured.update((m) => ({ ...m, [item.id]: ratio }));
  }

  public onEnter(item: PortfolioItem): void {
    if (this.canHover()) this.hovered.set(item.id);
  }

  public onLeave(): void {
    this.hovered.set(null);
  }

  public photoCount(item: PortfolioItem): number {
    return item.images?.length ?? 0;
  }
}
