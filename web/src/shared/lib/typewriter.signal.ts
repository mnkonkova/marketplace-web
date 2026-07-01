import { DestroyRef, Signal, inject, signal } from '@angular/core';

interface TypewriterOpts {
  /** Фразы для ротации по кругу. Не пустой массив. */
  phrases: string[];
  /** Скорость набора буквы в мс. */
  typeMs: number;
  /** Пауза на полностью набранной фразе в мс. */
  pauseMs: number;
  /** Скорость стирания буквы в мс. */
  eraseMs: number;
  /** Пауза между фразами в мс. */
  betweenMs: number;
}

/**
 * createTypewriter — signal с ротирующимся текстом, симулирующим набор.
 * Использовать для placeholder'а input'а:
 *   placeholder = createTypewriter({...});
 *   [attr.placeholder]="placeholder()"
 *
 * Автоматически останавливается через DestroyRef.onDestroy — компонент
 * не «утекает» после уничтожения.
 *
 * Уважает `prefers-reduced-motion: reduce` — при включённой опции
 * возвращает статичную первую фразу, без анимации.
 */
export function createTypewriter(opts: TypewriterOpts): Signal<string> {
  const destroyRef = inject(DestroyRef);
  const text = signal('');
  let timer: ReturnType<typeof setTimeout> | null = null;

  const schedule = (fn: () => void, ms: number): void => {
    timer = setTimeout(fn, ms);
  };

  let phraseIdx = 0;
  let charIdx = 0;
  let phase: 'type' | 'pause' | 'erase' | 'between' = 'type';

  const tick = (): void => {
    const phrase = opts.phrases[phraseIdx];
    switch (phase) {
      case 'type':
        if (charIdx < phrase.length) {
          charIdx++;
          text.set(phrase.slice(0, charIdx));
          schedule(tick, opts.typeMs);
        } else {
          phase = 'pause';
          schedule(tick, opts.pauseMs);
        }
        break;
      case 'pause':
        phase = 'erase';
        schedule(tick, opts.eraseMs);
        break;
      case 'erase':
        if (charIdx > 0) {
          charIdx--;
          text.set(phrase.slice(0, charIdx));
          schedule(tick, opts.eraseMs);
        } else {
          phase = 'between';
          schedule(tick, opts.betweenMs);
        }
        break;
      case 'between':
        phraseIdx = (phraseIdx + 1) % opts.phrases.length;
        phase = 'type';
        schedule(tick, opts.typeMs);
        break;
    }
  };

  // Accessibility: юзер отключил анимации в OS → статичная первая фраза.
  const reduced =
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  if (reduced) {
    text.set(opts.phrases[0]);
  } else {
    tick();
  }

  destroyRef.onDestroy(() => {
    if (timer) clearTimeout(timer);
  });

  return text.asReadonly();
}
