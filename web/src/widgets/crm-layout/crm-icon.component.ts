import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/** Имена иконок разделов. Ровно те, что есть в сайдбаре, — не библиотека. */
export type CrmIconName =
  | 'home'
  | 'inbox'
  | 'folder'
  | 'shield'
  | 'team'
  | 'spec'
  | 'client'
  | 'price'
  | 'check'
  | 'flow'
  | 'studio'
  | 'back'
  | 'exit';

/**
 * Иконка пункта меню.
 *
 * Разметкой, а не строкой в data: путь иконки — это HTML, и подставлять
 * его через innerHTML пришлось бы в обход санитайзера. Ради двенадцати
 * фигур это плохой размен; @switch читается так же, а обходить ничего не
 * нужно.
 */
@Component({
  selector: 'app-crm-icon',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.7"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      @switch (name()) {
        @case ('home') {
          <path d="M4 11l8-7 8 7v8a1 1 0 0 1-1 1h-4v-6h-6v6H5a1 1 0 0 1-1-1z" />
        }
        @case ('inbox') {
          <path d="M3 13l2.5-7h13L21 13v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
          <path d="M3 13h5l1.5 2.5h5L16 13h5" />
        }
        @case ('folder') {
          <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
        }
        @case ('shield') {
          <path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z" />
          <path d="M9 12l2 2 4-4" />
        }
        @case ('team') {
          <circle cx="9" cy="8" r="3.2" />
          <path d="M3.5 19c.6-3 2.8-4.6 5.5-4.6s4.9 1.6 5.5 4.6" />
          <path d="M16 5.5a3 3 0 0 1 0 5.6M17.5 14.6c1.7.6 2.8 2 3.1 4.4" />
        }
        @case ('spec') {
          <rect x="3" y="6" width="13" height="12" rx="2" />
          <path d="M16 10l5-3v10l-5-3" />
        }
        @case ('client') {
          <rect x="3" y="7" width="18" height="13" rx="2" />
          <path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M3 12h18" />
        }
        @case ('price') {
          <path d="M4 12V5a1 1 0 0 1 1-1h7l8 8-8 8z" />
          <circle cx="8.5" cy="8.5" r="1.3" />
        }
        @case ('check') {
          <path d="M10 6h10M10 12h10M10 18h10" />
          <path d="M3.5 6l1.2 1.2L7 5M3.5 12l1.2 1.2L7 11M3.5 18l1.2 1.2L7 17" />
        }
        @case ('flow') {
          <circle cx="6" cy="6" r="2.2" />
          <circle cx="6" cy="18" r="2.2" />
          <circle cx="18" cy="12" r="2.2" />
          <path d="M6 8.2v7.6M8.2 6H12a4 4 0 0 1 4 4M8.2 18H12a4 4 0 0 0 4-4" />
        }
        @case ('studio') {
          <path d="M4 20V6l7-3v17M11 20V9l9 3v8M3 20h18M7 9h1M7 13h1M7 17h1M15 14h1M15 17h1" />
        }
        @case ('back') {
          <path d="M10 6l-6 6 6 6M4 12h16" />
        }
        @case ('exit') {
          <path d="M15 17l5-5-5-5M20 12H9" />
          <path d="M12 20H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h6" />
        }
      }
    </svg>
  `,
  styles: [
    `
      :host {
        display: inline-flex;
        flex: 0 0 auto;
      }

      svg {
        width: 16px;
        height: 16px;
      }
    `,
  ],
})
export class CrmIconComponent {
  public readonly name = input.required<CrmIconName>();
}
