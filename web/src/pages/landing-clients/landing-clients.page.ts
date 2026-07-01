import { ChangeDetectionStrategy, Component, OnInit, inject } from '@angular/core';
import { Title, Meta } from '@angular/platform-browser';
import { NzMessageService } from 'ng-zorro-antd/message';
import { NzModalService } from 'ng-zorro-antd/modal';
import { AppHeaderComponent } from '@widgets/app-header/app-header.component';
import { SupportFooterComponent } from '@widgets/support-footer/support-footer.component';
import { LandingHeroComponent } from '@widgets/landing-hero/landing-hero.component';
import { AuthDialogComponent } from '@features/auth/ui/auth.dialog';
import { LeadSubmitDialogComponent } from '@features/project-cart/ui/components/lead-submit/lead-submit.dialog';
import { ProjectCartStore } from '@features/project-cart/model/project-cart.store';
import { AuthSessionStore } from '@entities/auth/model/auth-session.store';

// WAYPROD — inhouse-студия. Открывая бриф с лендинга, клиент получает
// её предвыбранной как единственного «спеца» в корзине. UUID зафиксирован
// (создан вручную в БД, продовый), поэтому hardcode оправдан.
const WAYPROD_USER_ID = 'd1db3fa9-368f-4410-bc1b-5037ccc7ce89';
const WAYPROD_DISPLAY_NAME = 'wayprod — студия wayprmarket';

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
  private readonly modal = inject(NzModalService);
  private readonly msg = inject(NzMessageService);
  private readonly cart = inject(ProjectCartStore);
  private readonly auth = inject(AuthSessionStore);

  // «Опубликовать первую заявку» — клиент попадает сразу в форму брифа,
  // где WAYPROD уже выбран как исполнитель. Если не залогинен, сначала
  // предлагаем зарегистрироваться (без этого /leads всё равно упадёт
  // на contacts_required — лучше явный шаг чем 400).
  public openBriefWithWayprod(): void {
    if (!this.auth.isLoggedIn()) {
      this.msg.info('Зарегистрируйтесь — заявка появится в вашем кабинете');
      this.modal.create({
        nzContent: AuthDialogComponent,
        nzFooter: null,
        nzWidth: 'min(420px, 92vw)',
        nzData: { initialTab: 1, initialKind: 'client' },
      });
      return;
    }
    // Кладём WAYPROD в корзину как единственного «спеца». Если раньше
    // юзер набрал других — очищаем: лендинг-CTA семантически означает
    // «начать с чистого листа».
    this.cart.clear();
    this.cart.toggle({
      user_id: WAYPROD_USER_ID,
      display_name: WAYPROD_DISPLAY_NAME,
    });
    this.modal.create({
      nzContent: LeadSubmitDialogComponent,
      nzFooter: null,
      nzWidth: 540,
      nzClassName: 'project-modal',
      nzCentered: true,
    });
  }

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
