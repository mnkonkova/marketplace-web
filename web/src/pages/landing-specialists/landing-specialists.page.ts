import { ChangeDetectionStrategy, Component, OnInit, inject } from '@angular/core';
import { Title, Meta } from '@angular/platform-browser';
import { NzModalService } from 'ng-zorro-antd/modal';
import { AppHeaderComponent } from '@widgets/app-header/app-header.component';
import { SupportFooterComponent } from '@widgets/support-footer/support-footer.component';
import { LandingHeroComponent } from '@widgets/landing-hero/landing-hero.component';
import { AuthDialogComponent } from '@features/auth/ui/auth.dialog';

@Component({
  selector: 'app-landing-specialists-page',
  standalone: true,
  imports: [AppHeaderComponent, SupportFooterComponent, LandingHeroComponent],
  templateUrl: './landing-specialists.page.html',
  styleUrl: './landing-specialists.page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LandingSpecialistsPage implements OnInit {
  private readonly title = inject(Title);
  private readonly meta = inject(Meta);
  private readonly modal = inject(NzModalService);

  // Открывает AuthDialog на вкладке «Регистрация» с уже выбранным
  // типом аккаунта = specialist. Категорию юзер выбирает в кабинете
  // при первом заходе в /me/specialist — на лендинге сокращаем воронку
  // до одного клика.
  public openRegisterSpecialist(): void {
    this.modal.create({
      nzContent: AuthDialogComponent,
      nzFooter: null,
      nzWidth: 'min(420px, 92vw)',
      nzData: { initialTab: 1, initialKind: 'specialist' },
    });
  }

  // «Что вы получаете» для спецов. Один пункт помечен beta = true —
  // регулярные подборки вакансий (агрегация с интернета) в бета.
  public readonly benefits = [
    {
      title: 'Регулярные подборки вакансий',
      text: 'Клиенты пишут бриф, мы рассылаем релевантным специалистам. Плюс собираем релевантные вакансии со всего интернета — сразу в ваш кабинет, не надо вручную мониторить каналы и биржи.',
      beta: true,
    },
    {
      title: 'Заявки в кабинет',
      text: 'Все обращения и истории сделок в одном месте.',
      beta: false,
    },
    {
      title: 'Прозрачные ставки',
      text: 'Клиент видит вашу вилку, никаких торгов вслепую.',
      beta: false,
    },
    {
      title: 'Легально',
      text: 'Работаем с ИП и самозанятыми, документы и оплаты — на нас.',
      beta: false,
    },
  ];

  public readonly howSteps = [
    { num: 1, title: 'Заполните профиль', text: 'Имя, фото, био, навыки, ставки.' },
    { num: 2, title: 'Загрузите 3–5 кейсов', text: 'С описанием результата.' },
    { num: 3, title: 'Опубликуйте профиль', text: 'Модерация 1–2 рабочих дня.' },
  ];

  public ngOnInit(): void {
    this.title.setTitle('Для специалистов — wayprmarket');
    this.meta.updateTag({
      name: 'description',
      content:
        'Получайте проекты от проверенных клиентов. Без обхода маркетплейса, легально, с поддержкой менеджера.',
    });
    this.meta.updateTag({ property: 'og:title', content: 'wayprmarket для специалистов' });
    this.meta.updateTag({
      property: 'og:description',
      content: 'Получайте проекты от проверенных клиентов. Легально, с поддержкой менеджера.',
    });
  }
}
