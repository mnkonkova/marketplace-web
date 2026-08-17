import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  afterNextRender,
  computed,
  input,
  signal,
  viewChild,
} from '@angular/core';

/** Строка «О себе» после разбора: либо абзац, либо пункт списка. */
interface BioBlock {
  kind: 'paragraph' | 'list';
  /** Для 'paragraph' — один текст, для 'list' — пункты. */
  lines: string[];
}

/**
 * Маркеры списка, которые спецы реально печатают в поле «О себе».
 * `(?:\s+|$)` — чтобы строка из одного маркера тоже считалась пунктом:
 * иначе она проваливается в ветку абзаца и рендерится голым эмодзи.
 */
const BULLET_RE = /^\s*(?:✅|✔️|✔|☑️|•|●|▪|·|—|–|-|\*)(?:\s+|$)/u;

/**
 * «О себе» в читаемом виде: ограниченная ширина, аккуратный список вместо
 * стены эмодзи-галочек, сворачивание длинного текста.
 *
 * Текст не переписываем и не сокращаем по смыслу — только форматируем то,
 * что специалист написал сам.
 */
@Component({
  selector: 'app-rich-bio',
  standalone: true,
  template: `
    <div class="rich-bio">
      <div #body class="rich-bio__body" [class.is-clamped]="!expanded() && overflowing()">
        @for (block of blocks(); track $index) {
          @if (block.kind === 'list') {
            <ul class="rich-bio__list">
              @for (line of block.lines; track line) {
                <li>{{ line }}</li>
              }
            </ul>
          } @else {
            <p>{{ block.lines[0] }}</p>
          }
        }
      </div>
      @if (overflowing()) {
        <button type="button" class="rich-bio__more" (click)="toggle()">
          {{ expanded() ? 'Свернуть' : 'Показать полностью' }}
        </button>
      }
    </div>
  `,
  styleUrl: './rich-bio.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RichBioComponent {
  public readonly text = input<string>('');

  public readonly expanded = signal(false);

  /** Кнопка нужна только если текст реально не влез в свёрнутую высоту. */
  public readonly overflowing = signal(false);

  private readonly body = viewChild<ElementRef<HTMLElement>>('body');

  public readonly blocks = computed<BioBlock[]>(() => parseBio(this.text()));

  constructor() {
    // Профиль приходит одним ответом, компонент создаётся уже с текстом —
    // одной проверки после первого рендера достаточно.
    afterNextRender(() => {
      const el = this.body()?.nativeElement;
      if (!el) return;
      this.overflowing.set(el.scrollHeight - el.clientHeight > 8);
    });
  }

  public toggle(): void {
    this.expanded.update((v) => !v);
  }
}

/**
 * Разбор «О себе» в блоки. Схлопывает лишние пробелы, сохраняет переносы,
 * склеивает подряд идущие пункты в один список.
 */
export function parseBio(raw: string): BioBlock[] {
  const lines = raw
    .replace(/\r\n?/g, '\n')
    // Схлопываем только горизонтальные пробелы: переносы несут структуру.
    .replace(/[^\S\n]+/g, ' ')
    .split('\n')
    .map((l) => l.trim());

  const blocks: BioBlock[] = [];
  let list: string[] | null = null;
  let paragraph: string[] = [];

  const flushParagraph = (): void => {
    if (paragraph.length) {
      blocks.push({ kind: 'paragraph', lines: [paragraph.join(' ')] });
      paragraph = [];
    }
  };
  const flushList = (): void => {
    if (list?.length) blocks.push({ kind: 'list', lines: list });
    list = null;
  };

  for (const line of lines) {
    if (!line) {
      flushParagraph();
      flushList();
      continue;
    }
    if (BULLET_RE.test(line)) {
      flushParagraph();
      const item = line.replace(BULLET_RE, '').trim();
      if (!item) continue;
      list = list ?? [];
      list.push(item);
      continue;
    }
    flushList();
    paragraph.push(line);
  }
  flushParagraph();
  flushList();
  return blocks;
}
