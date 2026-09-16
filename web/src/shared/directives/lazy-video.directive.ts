import { DestroyRef, Directive, ElementRef, inject, input } from '@angular/core';

/**
 * Видео-превью, которое грузится и играет только пока карточка на экране.
 *
 * На выдаче до полусотни карточек. Раньше на каждой стояло autoplay с
 * preload="metadata", и страница тянула все ролики разом — 216 МБ за заход.
 * Здесь источник подставляется в момент появления в зоне видимости, а при
 * уходе с экрана воспроизведение останавливается: за пределами вьюпорта
 * ролик всё равно никто не смотрит, а декодирование стоит батареи.
 */
@Directive({
  selector: 'video[appLazyVideo]',
  standalone: true,
})
export class LazyVideoDirective {
  /** Адрес ролика. Пустой — директива ничего не делает. */
  public readonly appLazyVideo = input('');

  private readonly el = inject(ElementRef<HTMLVideoElement>);

  private loaded = false;

  public constructor() {
    const video = this.el.nativeElement as HTMLVideoElement;

    // rootMargin — начинаем чуть раньше, чем карточка доедет до края экрана:
    // так при обычной прокрутке ролик успевает начаться без рывка.
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) this.start(video);
          else this.stop(video);
        }
      },
      { rootMargin: '200px 0px', threshold: 0.25 },
    );
    observer.observe(video);

    inject(DestroyRef).onDestroy(() => {
      observer.disconnect();
      release(video);
    });
  }

  private start(video: HTMLVideoElement): void {
    const src = this.appLazyVideo();
    if (!src) return;
    if (!this.loaded) {
      video.src = src;
      this.loaded = true;
    }
    void video.play().catch(() => {
      // Автовоспроизведение могли запретить политикой браузера — на карточке
      // останется постер, и это нормально.
    });
  }

  private stop(video: HTMLVideoElement): void {
    if (!this.loaded) return;
    video.pause();
  }
}

/**
 * Отпустить ролик, когда карточка уходит со страницы.
 *
 * Отключить наблюдателя мало. Пока у элемента стоит src, браузер держит и
 * сам <video>, и его внутреннее дерево плеера — около сорока узлов на
 * ролик, — даже когда из кода на элемент не ссылается уже никто. Сборщик
 * мусора тут не поможет: держит не JavaScript, а движок.
 *
 * Видно это только в счётчике узлов документа: сто двадцать переходов
 * между выдачей и посадочной страницей давали рост с двух тысяч узлов до
 * ста четырёх тысяч, линейно и без плато. На выдаче до полусотни
 * карточек, и человек, который листает каталог, к десятому экрану
 * получает вкладку, которая тормозит.
 *
 * Порядок важен: сначала пауза (иначе декодер продолжит работу), потом
 * снятие src, потом load() — он и заставляет движок отпустить буферы.
 * Тот же порядок стоит в progressive-video.directive.
 */
function release(video: HTMLVideoElement): void {
  try {
    video.pause();
    video.removeAttribute('src');
    video.load();
  } catch {
    // Элемент могли уже вынуть из документа — отпускать нечего.
  }
}
