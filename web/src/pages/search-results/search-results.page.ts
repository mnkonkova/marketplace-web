import { ChangeDetectionStrategy, Component } from '@angular/core';
import { AppHeaderComponent } from '@widgets/app-header/app-header.component';

// Skeleton — реализация в следующем коммите v2.1 (шаг #2 из плана).
// Роут /search уже указывает сюда; чтобы не 404-ить существующим ссылкам,
// временно рендерим заголовок и заметку. Feed-page ещё живёт рядом до
// шага #4 (полное удаление). До того момента можно вернуть роут на
// FeedPage если что-то критичное сломается.
@Component({
  selector: 'app-search-results-page',
  standalone: true,
  imports: [AppHeaderComponent],
  template: `
    <app-header />
    <main class="stub">
      <h1>Поиск</h1>
      <p>Страница результатов в разработке. Верните позже.</p>
    </main>
  `,
  styles: [
    `
      .stub {
        max-width: 720px;
        margin: 64px auto;
        padding: 0 24px;
        text-align: center;
        color: var(--text-muted);
      }
      h1 {
        color: var(--text);
      }
    `,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SearchResultsPage {}
