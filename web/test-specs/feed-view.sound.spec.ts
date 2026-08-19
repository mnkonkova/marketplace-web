import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { of } from 'rxjs';

import { CategoryApi } from '@entities/category/api/category.api';
import { FeedApi } from '@entities/feed/api/feed.api';
import { FeedItem } from '@entities/feed/model/feed.types';
import { ProjectCartStore } from '@features/project-cart/model/project-cart.store';
import { ProgressiveUpgradeService } from '@shared/video/progressive-upgrade.service';
import { FeedViewComponent } from '@widgets/feed-view/feed-view.component';

/**
 * Плеер держит <video> вне шаблона (создаёт через document.createElement),
 * поэтому логику тапа проверяем на «руками» собранной карточке, а разметку
 * центральных контролов — на отрендеренном фикстуре. Само аудио в Karma не
 * проверить — сверяем video.muted и состояние UI.
 *
 * Модель поведения:
 *   тап по видео        → пауза / продолжить;
 *   на паузе по центру  → кнопка звука (сверху) + ▶ (снизу);
 *   кнопка звука        → мьют на месте, БЕЗ снятия с паузы.
 */
function makeTestBed(items: FeedItem[] = []): void {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      provideNoopAnimations(),
      { provide: FeedApi, useValue: { load: () => of({ items, next_cursor: '' }) } },
      { provide: CategoryApi, useValue: { list: () => of([]) } },
      {
        provide: ProjectCartStore,
        useValue: { specialists: signal([]), has: () => false, toggle: () => false },
      },
      {
        provide: ProgressiveUpgradeService,
        useValue: jasmine.createSpyObj<ProgressiveUpgradeService>('upgrade', ['acquire']),
      },
    ],
  });
}

function setup(): FeedViewComponent {
  makeTestBed();
  return TestBed.createComponent(FeedViewComponent).componentInstance;
}

function feedItem(): FeedItem {
  return {
    kind: 'video',
    // Без thumb/avatar — иначе шаблон полезет в сеть за постером.
    video: { id: 'v1', url: '', title: 'Работа', created_at: '2026-01-01T00:00:00Z' },
    specialist: {
      user_id: 'u1',
      display_name: 'Спец',
      categories: ['operator'],
      rating_avg: 0,
      reviews_count: 0,
    },
    video_idx: 0,
    video_total: 1,
  };
}

/**
 * Фикстура с одной отрисованной карточкой. Ленту наполняем сигналом, а не
 * ответом API: иначе запустится IntersectionObserver → ensureVideo → сетевой
 * запрос за видео, а нам нужна только разметка контролов.
 */
function render(): ComponentFixture<FeedViewComponent> {
  makeTestBed();
  const fixture = TestBed.createComponent(FeedViewComponent);
  fixture.detectChanges();
  fixture.componentInstance.videos.set([feedItem()]);
  fixture.componentInstance.empty.set(false);
  fixture.detectChanges();
  return fixture;
}

/** Карточка с видео внутри — то, на чём висит обработчик тапа. */
function articleWith(video: HTMLVideoElement, kind = 'video'): HTMLElement {
  const article = document.createElement('article');
  article.className = 'feed-item';
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
  // paused держим изменяемым: play()/pause() должны его переключать, иначе
  // не проверить круг «тап → пауза → тап → снова играет».
  let isPaused = paused;
  Object.defineProperty(v, 'paused', { get: () => isPaused, configurable: true });
  // Плеер не зовёт play() у видео без данных — ждёт canplay. В Karma
  // ничего не грузится, поэтому объявляем готовность явно: тестируем
  // логику тапа, а не сетевую загрузку.
  Object.defineProperty(v, 'readyState', {
    value: HTMLMediaElement.HAVE_ENOUGH_DATA,
    configurable: true,
  });
  spyOn(v, 'play').and.callFake(() => {
    isPaused = false;
    return Promise.resolve();
  });
  spyOn(v, 'pause').and.callFake(() => {
    isPaused = true;
  });
  return v;
}

function tap(comp: FeedViewComponent, article: HTMLElement): void {
  const video = article.querySelector('video')!;
  comp.togglePlayback({
    target: video,
    currentTarget: article,
  } as unknown as Event);
}

/** Событие «клик по кнопке в центре» — со шпионом на stopPropagation. */
function btnEvent(article?: HTMLElement): { ev: Event; stop: jasmine.Spy } {
  const stop = jasmine.createSpy('stopPropagation');
  const btn = document.createElement('button');
  if (article) article.appendChild(btn);
  return { ev: { stopPropagation: stop, currentTarget: btn } as unknown as Event, stop };
}

describe('FeedView — пауза и звук', () => {
  afterEach(() => {
    document.querySelectorAll('body > article').forEach((a) => a.remove());
    localStorage.removeItem('marketpclce.feed_muted.v1');
  });

  it('стартует без звука', () => {
    const comp = setup();
    expect(comp.muted()).toBeTrue();
  });

  // Юзер уже включал звук в прошлой сессии — незачем заставлять его
  // тапать снова.
  it('состояние звука восстанавливается из localStorage', () => {
    localStorage.setItem('marketpclce.feed_muted.v1', 'off');
    const comp = setup();
    expect(comp.muted()).toBeFalse();
  });

  it('тап по играющему видео ставит его на паузу', () => {
    const comp = setup();
    const video = makeVideo(false);
    const article = articleWith(video);

    tap(comp, article);

    expect(video.pause).toHaveBeenCalled();
    expect(video.paused).toBeTrue();
    expect(comp.showPlay()).toBeTrue();
  });

  it('повторный тап снимает с паузы', () => {
    const comp = setup();
    const video = makeVideo(false);
    const article = articleWith(video);

    tap(comp, article);
    tap(comp, article);

    expect(video.play).toHaveBeenCalled();
    expect(video.paused).toBeFalse();
    expect(comp.showPlay()).toBeFalse();
  });

  it('тап не трогает звук', () => {
    const comp = setup();
    const video = makeVideo(false);
    const article = articleWith(video);

    tap(comp, article);
    tap(comp, article);

    expect(video.muted).toBeTrue();
    expect(comp.muted()).toBeTrue();
    expect(localStorage.getItem('marketpclce.feed_muted.v1')).toBeNull();
  });

  // После progressive-upgrade в карточке какое-то время живут два <video>
  // (preview + full) — паузить надо оба, иначе звук «каши».
  it('пауза останавливает все видео карточки', () => {
    const comp = setup();
    const preview = makeVideo(false);
    const full = makeVideo(false);
    const article = articleWith(preview);
    full.className = 'feed-video';
    article.appendChild(full);

    tap(comp, article);

    expect(preview.pause).toHaveBeenCalled();
    expect(full.pause).toHaveBeenCalled();
  });

  it('тап по фото-сету ничего не делает', () => {
    const comp = setup();
    const video = makeVideo(false);
    const article = articleWith(video, 'image');

    tap(comp, article);

    expect(video.pause).not.toHaveBeenCalled();
    expect(video.play).not.toHaveBeenCalled();
  });

  it('тап по кнопке в оверлее не ставит на паузу', () => {
    const comp = setup();
    const video = makeVideo(false);
    const article = articleWith(video);
    const btn = document.createElement('button');
    article.appendChild(btn);

    comp.togglePlayback({ target: btn, currentTarget: article } as unknown as Event);

    expect(video.pause).not.toHaveBeenCalled();
  });

  it('кнопка звука переключает mute', () => {
    const comp = setup();
    const video = makeVideo(true);
    articleWith(video);

    comp.toggleSound(btnEvent().ev);
    expect(video.muted).toBeFalse();
    expect(comp.muted()).toBeFalse();

    comp.toggleSound(btnEvent().ev);
    expect(video.muted).toBeTrue();
    expect(comp.muted()).toBeTrue();
  });

  // Главное отличие от старой модели: звук — отдельная кнопка, она не
  // должна ни паузить, ни доигрывать. Продолжение — соседняя ▶.
  it('кнопка звука не снимает с паузы и не паузит', () => {
    const comp = setup();
    const video = makeVideo(true);
    articleWith(video);
    comp.showPlay.set(true);

    comp.toggleSound(btnEvent().ev);

    expect(video.play).not.toHaveBeenCalled();
    expect(video.pause).not.toHaveBeenCalled();
    expect(video.paused).toBeTrue();
    expect(comp.showPlay()).toBeTrue();
  });

  // Без stopPropagation click всплывёт до <article> и togglePlayback
  // переключит воспроизведение ещё раз.
  it('кнопка звука гасит всплытие клика', () => {
    const comp = setup();
    const { ev, stop } = btnEvent();

    comp.toggleSound(ev);

    expect(stop).toHaveBeenCalled();
  });

  // Атрибут muted нужен iOS для autoplay, но, оставшись после unmute, он
  // снова заглушит видео при пересоздании элемента (progressive-upgrade).
  it('после включения звука атрибут muted снимается', () => {
    const comp = setup();
    const video = makeVideo(true);
    video.setAttribute('muted', '');
    articleWith(video);

    comp.toggleSound(btnEvent().ev);
    expect(video.hasAttribute('muted')).toBeFalse();

    comp.toggleSound(btnEvent().ev);
    expect(video.hasAttribute('muted')).toBeTrue();
  });

  // Выбор звука применяется ко ВСЕМ видео ленты, а не только к активному:
  // иначе следующая работа после свайпа снова оказывается немой, и юзеру
  // приходится жать на каждой.
  it('звук применяется ко всем работам в ленте, а не только к текущей', () => {
    const comp = setup();
    const current = makeVideo(true);
    const next = makeVideo(true);
    articleWith(current);
    articleWith(next);

    comp.toggleSound(btnEvent().ev);

    expect(current.muted).toBeFalse();
    expect(next.muted).toBeFalse();
  });

  it('выключение звука тоже применяется ко всем', () => {
    const comp = setup();
    const current = makeVideo(true, false);
    const next = makeVideo(true, false);
    articleWith(current);
    articleWith(next);
    comp.setMuted(false);

    comp.toggleSound(btnEvent().ev);

    expect(current.muted).toBeTrue();
    expect(next.muted).toBeTrue();
  });

  it('выбор звука переживает перезагрузку — пишется в localStorage', () => {
    const comp = setup();
    articleWith(makeVideo(true));

    comp.toggleSound(btnEvent().ev);
    expect(localStorage.getItem('marketpclce.feed_muted.v1')).toBe('off');

    comp.toggleSound(btnEvent().ev);
    expect(localStorage.getItem('marketpclce.feed_muted.v1')).toBe('on');
  });

  it('кнопка ▶ продолжает воспроизведение и убирает оверлей', () => {
    const comp = setup();
    const video = makeVideo(true);
    const article = articleWith(video);
    comp.showPlay.set(true);
    const { ev, stop } = btnEvent(article);

    comp.resumePlayback(ev);

    expect(video.play).toHaveBeenCalled();
    expect(comp.showPlay()).toBeFalse();
    expect(stop).toHaveBeenCalled();
  });

  it('кнопка ▶ не трогает звук', () => {
    const comp = setup();
    const video = makeVideo(true);
    const article = articleWith(video);

    comp.resumePlayback(btnEvent(article).ev);

    expect(video.muted).toBeTrue();
    expect(comp.muted()).toBeTrue();
  });

  // Если воспроизведение не завелось вовсе (кодек, битый файл, политика),
  // ▶ обязан появиться сам — иначе юзер смотрит на статичный кадр.
  it('▶ показывается сам, если play() отклонён', async () => {
    const comp = setup();
    const video = makeVideo(true);
    (video.play as jasmine.Spy).and.returnValue(Promise.reject(new Error('no codec')));
    const article = articleWith(video);
    // markPaused показывает ▶ только для активной карточки; в юните её
    // некому назначить — активацию делает IntersectionObserver.
    (comp as unknown as { activeArticle: HTMLElement | null }).activeArticle = article;

    comp.resumePlayback(btnEvent(article).ev);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(comp.showPlay()).toBeTrue();
  });

  it('на паузе по центру рисуются две кнопки: звук сверху, ▶ снизу', () => {
    const fixture = render();
    fixture.componentInstance.activeIndex.set(0);
    fixture.componentInstance.showPlay.set(true);
    fixture.detectChanges();

    const controls = fixture.nativeElement.querySelector('.feed-center-controls') as HTMLElement;
    expect(controls).toBeTruthy();
    const buttons = controls.querySelectorAll('button');
    expect(buttons.length).toBe(2);
    expect(buttons[0].classList).toContain('feed-sound-btn');
    expect(buttons[1].classList).toContain('feed-play-btn');
  });

  it('во время проигрывания центрального оверлея нет', () => {
    const fixture = render();
    fixture.componentInstance.activeIndex.set(0);
    fixture.componentInstance.showPlay.set(false);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.feed-center-controls')).toBeNull();
  });

  // Иконки — только inline-SVG. Эмодзи 🔊/🔇 из прошлой версии выпилены.
  it('иконки — inline-SVG без эмодзи, и звук меняет иконку на месте', () => {
    const fixture = render();
    const comp = fixture.componentInstance;
    comp.activeIndex.set(0);
    comp.showPlay.set(true);
    fixture.detectChanges();

    const controls = () => fixture.nativeElement.querySelector('.feed-center-controls') as HTMLElement;
    expect(controls().querySelectorAll('svg').length).toBe(2);
    expect(controls().textContent).not.toMatch(/[🔊🔇🔈🔉]/u);

    const soundBtn = controls().querySelector('.feed-sound-btn') as HTMLButtonElement;
    const mutedIcon = soundBtn.innerHTML;
    expect(soundBtn.getAttribute('aria-label')).toBe('Включить звук');

    soundBtn.click();
    fixture.detectChanges();

    const onBtn = controls().querySelector('.feed-sound-btn') as HTMLButtonElement;
    expect(comp.muted()).toBeFalse();
    expect(onBtn.innerHTML).not.toBe(mutedIcon);
    expect(onBtn.getAttribute('aria-label')).toBe('Выключить звук');
    // Клик по кнопке не должен схлопнуть оверлей — звук меняется на месте.
    expect(comp.showPlay()).toBeTrue();
  });
});
