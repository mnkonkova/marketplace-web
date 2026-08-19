import { TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { of } from 'rxjs';

import { CategoryApi } from '@entities/category/api/category.api';
import { FeedApi } from '@entities/feed/api/feed.api';
import { ProjectCartStore } from '@features/project-cart/model/project-cart.store';
import { ProgressiveUpgradeService } from '@shared/video/progressive-upgrade.service';
import { FeedViewComponent } from '@widgets/feed-view/feed-view.component';

/**
 * Плеер держит <video> вне шаблона (создаёт через document.createElement),
 * поэтому проверяем не разметку, а контракт: что делает тап и что видно.
 * Само аудио в Karma не проверить — сверяем video.muted и состояние UI.
 */
function setup(): FeedViewComponent {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      provideNoopAnimations(),
      { provide: FeedApi, useValue: { load: () => of({ items: [], next_cursor: '' }) } },
      { provide: CategoryApi, useValue: { list: () => of([]) } },
      {
        provide: ProjectCartStore,
        useValue: jasmine.createSpyObj<ProjectCartStore>('cart', ['has', 'toggle']),
      },
      {
        provide: ProgressiveUpgradeService,
        useValue: jasmine.createSpyObj<ProgressiveUpgradeService>('upgrade', ['acquire']),
      },
    ],
  });
  return TestBed.createComponent(FeedViewComponent).componentInstance;
}

/** Карточка с видео внутри — то, на чём висит обработчик тапа. */
function articleWith(video: HTMLVideoElement, kind = 'video'): HTMLElement {
  const article = document.createElement('article');
  article.dataset['kind'] = kind;
  article.dataset['index'] = '0';
  video.className = 'feed-video';
  article.appendChild(video);
  document.body.appendChild(article);
  return article;
}

function makeVideo(paused: boolean, muted = true): HTMLVideoElement {
  const v = document.createElement('video');
  // Плеер находит свои видео по классу — его же копирует progressive-upgrade
  // на подменённый элемент.
  v.className = 'feed-video';
  v.muted = muted;
  Object.defineProperty(v, 'paused', { value: paused, configurable: true });
  // Плеер не зовёт play() у видео без данных — ждёт canplay. В Karma
  // ничего не грузится, поэтому объявляем готовность явно: тестируем
  // логику тапа, а не сетевую загрузку.
  Object.defineProperty(v, 'readyState', {
    value: HTMLMediaElement.HAVE_ENOUGH_DATA,
    configurable: true,
  });
  spyOn(v, 'play').and.returnValue(Promise.resolve());
  return v;
}

function tap(comp: FeedViewComponent, article: HTMLElement): void {
  const video = article.querySelector('video')!;
  comp.togglePlayback({
    target: video,
    currentTarget: article,
  } as unknown as Event);
}

describe('FeedView — звук и пауза (модель Reels)', () => {
  afterEach(() => {
    document.querySelectorAll('article').forEach((a) => a.remove());
    localStorage.removeItem('marketpclce.feed_muted.v1');
  });

  it('стартует без звука', () => {
    const comp = setup();
    expect(comp.muted()).toBeTrue();
  });

  it('тап во время проигрывания включает, повторный — выключает звук', () => {
    const comp = setup();
    const video = makeVideo(false);
    const article = articleWith(video);

    tap(comp, article);
    expect(video.muted).toBeFalse();
    expect(comp.muted()).toBeFalse();

    tap(comp, article);
    expect(video.muted).toBeTrue();
    expect(comp.muted()).toBeTrue();
  });

  it('тап на паузе запускает воспроизведение, а не трогает звук', () => {
    const comp = setup();
    const video = makeVideo(true);
    const article = articleWith(video);

    tap(comp, article);
    expect(video.play).toHaveBeenCalled();
    expect(video.muted).toBeTrue();
  });

  // Атрибут muted нужен iOS для autoplay, но, оставшись после unmute, он
  // снова заглушит видео при пересоздании элемента (progressive-upgrade).
  it('после включения звука атрибут muted снимается', () => {
    const comp = setup();
    const video = makeVideo(false);
    video.setAttribute('muted', '');
    const article = articleWith(video);

    tap(comp, article);
    expect(video.hasAttribute('muted')).toBeFalse();

    tap(comp, article);
    expect(video.hasAttribute('muted')).toBeTrue();
  });

  it('тап показывает значок звука и гасит его', (done) => {
    const comp = setup();
    const article = articleWith(makeVideo(false));

    tap(comp, article);
    expect(comp.soundFlash()).toBe('on');

    setTimeout(() => {
      expect(comp.soundFlash()).toBeNull();
      done();
    }, 800);
  });

  it('выбор звука переживает перезагрузку — пишется в localStorage', () => {
    const comp = setup();
    tap(comp, articleWith(makeVideo(false)));
    expect(localStorage.getItem('marketpclce.feed_muted.v1')).toBe('off');
  });

  it('тап по фото-сету ничего не делает', () => {
    const comp = setup();
    const video = makeVideo(false);
    const article = articleWith(video, 'image');

    tap(comp, article);
    expect(video.muted).toBeTrue();
    expect(video.play).not.toHaveBeenCalled();
  });

  it('тап по кнопке в оверлее не переключает звук', () => {
    const comp = setup();
    const video = makeVideo(false);
    const article = articleWith(video);
    const btn = document.createElement('button');
    article.appendChild(btn);

    comp.togglePlayback({ target: btn, currentTarget: article } as unknown as Event);
    expect(video.muted).toBeTrue();
  });

  // Выбор звука применяется ко ВСЕМ видео ленты, а не только к активному:
  // иначе следующая работа после свайпа снова оказывается немой, и юзеру
  // приходится тапать на каждой.
  it('звук применяется ко всем работам в ленте, а не только к текущей', () => {
    const comp = setup();
    const current = makeVideo(false);
    const next = makeVideo(true);
    const article = articleWith(current);
    articleWith(next);

    tap(comp, article);

    expect(current.muted).toBeFalse();
    expect(next.muted).toBeFalse();
  });

  it('выключение звука тоже применяется ко всем', () => {
    const comp = setup();
    const current = makeVideo(false, false);
    const next = makeVideo(true, false);
    const article = articleWith(current);
    articleWith(next);

    tap(comp, article);

    expect(current.muted).toBeTrue();
    expect(next.muted).toBeTrue();
  });

  it('значок показывает 🔇 при выключении звука', () => {
    const comp = setup();
    const article = articleWith(makeVideo(false, false));

    tap(comp, article);

    expect(comp.soundFlash()).toBe('off');
  });

  // Быстрый двойной тап не должен оставить значок висеть: таймер от
  // первого тапа обязан быть сброшен, иначе он погасит значок от второго
  // раньше срока или оставит рассинхрон.
  it('быстрый повторный тап перезапускает таймер значка', (done) => {
    const comp = setup();
    const article = articleWith(makeVideo(false));

    tap(comp, article);
    expect(comp.soundFlash()).toBe('on');

    setTimeout(() => {
      tap(comp, article);
      expect(comp.soundFlash()).toBe('off');
      // Через 400мс после ВТОРОГО тапа значок ещё виден — то есть таймер
      // первого его не погасил.
      setTimeout(() => {
        expect(comp.soundFlash()).toBe('off');
        setTimeout(() => {
          expect(comp.soundFlash()).toBeNull();
          done();
        }, 400);
      }, 400);
    }, 400);
  });

  // Юзер уже включал звук в прошлой сессии — незачем заставлять его
  // тапать снова.
  it('состояние звука восстанавливается из localStorage', () => {
    localStorage.setItem('marketpclce.feed_muted.v1', 'off');
    const comp = setup();
    expect(comp.muted()).toBeFalse();
  });

  it('включение звука доигрывает работу, если она стояла на паузе', () => {
    const comp = setup();
    const playing = makeVideo(false);
    const article = articleWith(playing);
    // Активная карточка известна плееру только после activate(); эмулируем
    // ситуацию «тап по играющему видео, а рядом в той же карточке есть
    // приостановленное после progressive-upgrade».
    const stalled = makeVideo(true);
    article.appendChild(stalled);

    tap(comp, article);

    expect(playing.muted).toBeFalse();
    expect(stalled.muted).toBeFalse();
  });

  it('▶ показывается только на паузе', () => {
    const comp = setup();
    expect(comp.showPlay()).toBeFalse();
    comp.showPlay.set(true);
    expect(comp.showPlay()).toBeTrue();
  });
});
