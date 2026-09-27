import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { LazyVideoDirective } from '@shared/directives/lazy-video.directive';

/**
 * Ролик обязан отпустить браузер, когда карточка уходит со страницы.
 *
 * Пока у элемента стоит src, движок держит и сам <video>, и внутреннее
 * дерево плеера — около сорока узлов на ролик, — даже когда из кода на
 * него не ссылается уже никто. Сборщик мусора тут бессилен: держит не
 * JavaScript.
 *
 * Поймали это замером: сто двадцать переходов между выдачей и посадочной
 * страницей растили документ с двух тысяч узлов до ста четырёх тысяч,
 * линейно и без плато. В коде утечка выглядела невинно — отключали
 * наблюдателя и на этом заканчивали.
 *
 * Поэтому тест смотрит не на «вызвали ли метод», а на состояние
 * элемента после уничтожения: адреса на нём остаться не должно.
 */
@Component({
  standalone: true,
  imports: [LazyVideoDirective],
  template: `<video [appLazyVideo]="src" muted playsinline></video>`,
})
class HostComponent {
  public src = 'blob:https://example.test/clip';
}

describe('LazyVideoDirective', () => {
  let fixture: ComponentFixture<HostComponent>;
  let video: HTMLVideoElement;

  /**
   * IntersectionObserver в karma не срабатывает сам — карточка нигде не
   * «появляется». Подменяем его так, чтобы появление можно было вызвать
   * руками: без этого ролик не загружается и проверять нечего.
   */
  let appear: (() => void) | null = null;

  beforeEach(() => {
    appear = null;
    (window as unknown as { IntersectionObserver: unknown }).IntersectionObserver = class {
      public constructor(private readonly cb: (e: { isIntersecting: boolean }[]) => void) {
        appear = () => this.cb([{ isIntersecting: true }]);
      }
      public observe(): void {}
      public disconnect(): void {}
    };

    TestBed.configureTestingModule({ imports: [HostComponent] });
    fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    video = fixture.nativeElement.querySelector('video') as HTMLVideoElement;
    // play() в headless-браузере отклоняется политикой автозапуска, а
    // директива это гасит — но необработанное отклонение всё равно шумит
    // в отчёте. Подменяем на успешное.
    spyOn(video, 'play').and.returnValue(Promise.resolve());
    spyOn(video, 'load');
  });

  it('появилась на экране — ролик подставлен', () => {
    appear!();
    expect(video.getAttribute('src')).toBe('blob:https://example.test/clip');
  });

  it('карточка ушла со страницы — адрес снят, буферы отпущены', () => {
    appear!();
    expect(video.getAttribute('src')).withContext('до уничтожения адрес стоит').toBeTruthy();

    fixture.destroy();

    expect(video.getAttribute('src'))
      .withContext('пока src на месте, браузер держит <video> и дерево плеера')
      .toBeNull();
    expect(video.load).withContext('load() заставляет движок отпустить буферы').toHaveBeenCalled();
  });

  it('ролик так и не появлялся — уничтожение ничего не ломает', () => {
    expect(() => fixture.destroy()).not.toThrow();
  });
});
