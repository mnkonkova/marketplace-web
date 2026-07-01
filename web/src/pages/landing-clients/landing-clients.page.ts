import { ChangeDetectionStrategy, Component, OnInit, inject } from '@angular/core';
import { Title, Meta } from '@angular/platform-browser';
import { AppHeaderComponent } from '@widgets/app-header/app-header.component';
import { SupportFooterComponent } from '@widgets/support-footer/support-footer.component';
import { LandingHeroComponent } from '@widgets/landing-hero/landing-hero.component';

@Component({
  selector: 'app-landing-clients-page',
  standalone: true,
  imports: [AppHeaderComponent, SupportFooterComponent, LandingHeroComponent],
  templateUrl: './landing-clients.page.html',
  styleUrl: './landing-clients.page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LandingClientsPage implements OnInit {
  private readonly title = inject(Title);
  private readonly meta = inject(Meta);

  // Шаги «Как это работает» и «Что вы получаете» вынесены в constants —
  // проще редактировать текст, не трогая шаблон.
  public readonly howSteps = [
    { num: 1, title: 'Опишите задачу', text: 'Формат, бюджет, сроки, цели. 5 минут.' },
    {
      num: 2,
      title: 'Получите команды',
      text: 'Мы подобрали 2–3 варианта под бриф. Сравните портфолио, кейсы, цены.',
    },
    {
      num: 3,
      title: 'Запустите проект',
      text: 'Оплата через платформу, прозрачные этапы, поддержка менеджера до сдачи.',
    },
  ];

  public readonly benefits = [
    { title: 'Свобода выбора', text: 'Не один подрядчик, а 2–3 команды с разными подходами.' },
    {
      title: 'Гарантия качества',
      text: 'Модерация специалистов, контроль через менеджера, без обхода.',
    },
    { title: 'Контроль сроков', text: 'Этапы зафиксированы в сделке, менеджер ведёт календарь.' },
    { title: 'Без рисков по деньгам', text: 'Оплата по этапам, выплата исполнителю после приёмки.' },
  ];

  public readonly registerParams = { role: 'client', from: 'landing-clients' };

  public ngOnInit(): void {
    this.title.setTitle('Для заказчиков — wayprmarket');
    this.meta.updateTag({
      name: 'description',
      content:
        'Команды под рекламу без поиска и тендеров. Опишите задачу — соберём команду из проверенных специалистов.',
    });
    this.meta.updateTag({ property: 'og:title', content: 'wayprmarket для заказчиков' });
    this.meta.updateTag({
      property: 'og:description',
      content: 'Команды под рекламу — без поиска, тендеров и сюрпризов.',
    });
  }
}
