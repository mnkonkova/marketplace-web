import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * Заголовок раздела: название, одна строка пояснения и одна главная кнопка.
 *
 * Заголовки в CRM расходились на глаз: где-то `h1` в голом `<header>`,
 * где-то внутри `.crm-page` со своим кеглем, подзаголовок то абзацем на
 * четыре строки, то отсутствующий вовсе. Раздел при этом один и тот же —
 * список с действием.
 *
 * Ограничения намеренные. Пояснение — одно предложение: всё, что длиннее,
 * читают один раз и потом перескакивают, а место оно занимает каждый раз;
 * ширина ограничена 66 символами, дальше строка перестаёт читаться с
 * одного прохода. Кнопка одна: вторая на этом месте всегда оказывалась не
 * «ещё одним главным действием», а редким — ему хватает меню строки.
 *
 * Кнопку кладёт сам раздел: `<button head-action>…</button>`. Подпись у
 * неё — глагол с объектом («Создать воронку»), а не «+ Создать»: рядом со
 * списком воронок «Создать» ещё понятно, а в письме или в логе — уже нет.
 */
@Component({
  selector: 'app-page-head',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <header class="phead">
      <div class="t">
        <h1>{{ title() }}</h1>
        @if (subtitle()) {
          <p class="sub">{{ subtitle() }}</p>
        }
      </div>
      <div class="acts">
        <ng-content select="[head-action]" />
      </div>
    </header>
  `,
  styles: [
    `
      .phead {
        display: flex;
        align-items: flex-end;
        gap: 16px;
        flex-wrap: wrap;
        margin: 0 0 20px;
      }

      .t {
        flex: 1;
        min-width: 260px;
      }

      h1 {
        margin: 0;
        font-size: 26px;
        font-weight: 800;
        letter-spacing: -0.02em;
        line-height: 1.2;
        text-wrap: balance;
      }

      .sub {
        max-width: 66ch;
        margin: 6px 0 0;
        color: var(--text-muted);
        font-size: 13.5px;
        line-height: 1.5;
      }

      .acts {
        display: flex;
        align-items: center;
        gap: 8px;
        flex-wrap: wrap;
      }

      .acts:empty {
        display: none;
      }
    `,
  ],
})
export class PageHeadComponent {
  public readonly title = input.required<string>();

  public readonly subtitle = input('');
}
