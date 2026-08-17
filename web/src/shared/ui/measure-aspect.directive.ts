import {
  Directive,
  ElementRef,
  HostListener,
  afterNextRender,
  inject,
  output,
} from '@angular/core';
import { ratioFromElement } from '@shared/lib/portfolio-media';

/**
 * Измеряет формат медиа на клиенте — фолбэк для работ, у которых бэк ещё
 * не проставил aspect (загружены до ffprobe в transcode-пайплайне).
 *
 * Отдельная директива, потому что нужна и плитке ленты, и флагману, и
 * потому что здесь легко ошибиться: у картинки из кеша событие load уже
 * прошло к моменту, когда Angular вешает слушатель. Без проверки после
 * рендера такая работа навсегда осталась бы «вертикальной» — а вертикаль
 * у нас формат по умолчанию, то есть ошибка была бы незаметной.
 */
@Directive({
  selector: 'img[appMeasureAspect], video[appMeasureAspect]',
  standalone: true,
})
export class MeasureAspectDirective {
  /** Ширина/высота. Не эмитится, пока размеры неизвестны. */
  public readonly measured = output<number>();

  private readonly el =
    inject<ElementRef<HTMLImageElement | HTMLVideoElement>>(ElementRef).nativeElement;

  constructor() {
    afterNextRender(() => this.emit());
  }

  @HostListener('load')
  @HostListener('loadedmetadata')
  public emit(): void {
    const ratio = ratioFromElement(this.el);
    if (ratio != null) this.measured.emit(ratio);
  }
}
