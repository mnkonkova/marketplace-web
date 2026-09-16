import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzCardModule } from 'ng-zorro-antd/card';
import { NzTagModule } from 'ng-zorro-antd/tag';
import { NzProgressModule } from 'ng-zorro-antd/progress';
import { NzSpinModule } from 'ng-zorro-antd/spin';
import { NzEmptyModule } from 'ng-zorro-antd/empty';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { NzInputModule } from 'ng-zorro-antd/input';
import { NzMessageService } from 'ng-zorro-antd/message';
import { FormsModule } from '@angular/forms';

import { ClientProfile, ClientProfileApi } from '@entities/me/api/client-profile.api';
import { OrderApi } from '@entities/order/api/order.api';
import type { Order } from '@entities/order/model/order.types';
import { ProjectApi } from '@entities/project/api/project.api';
import { ProjectClientView } from '@entities/project/model/project.types';
import { PROJECT_STATUS_COLOR, PROJECT_STATUS_LABEL } from '@shared/lib/project-status';
import { AppHeaderComponent } from '@widgets/app-header/app-header.component';
import { ClientOverviewComponent } from '@widgets/client-overview/client-overview.component';
import { SupportFooterComponent } from '@widgets/support-footer/support-footer.component';
import { withFromPage } from '@shared/nav/from-page';

/** Вкладка кабинета: что в работе — или что за это получено. */
type CabinetTab = 'projects' | 'dashboard';

@Component({
  selector: 'app-projects-list-page',
  standalone: true,
  imports: [
    CommonModule,
    NzCardModule,
    NzTagModule,
    NzProgressModule,
    NzSpinModule,
    NzEmptyModule,
    NzIconModule,
    NzInputModule,
    NzButtonModule,
    FormsModule,
    AppHeaderComponent,
    ClientOverviewComponent,
    SupportFooterComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './projects-list.page.html',
  styleUrls: ['./projects-list.page.scss', './projects-list.page.touch.scss'],
})
export class ProjectsListPage {
  private readonly api = inject(ProjectApi);

  private readonly profileApi = inject(ClientProfileApi);

  private readonly orderApi = inject(OrderApi);

  private readonly router = inject(Router);

  private readonly route = inject(ActivatedRoute);

  private readonly destroyRef = inject(DestroyRef);

  private readonly msg = inject(NzMessageService);

  // Дашборд первым: с ним заказчик идёт к начальству, и открываться
  // кабинет должен ответом на «что я получаю за свои деньги», а не
  // списком дел. Проекты — второй вкладкой, за один щелчок.
  public readonly tabs: readonly { key: CabinetTab; title: string }[] = [
    { key: 'dashboard', title: 'Дашборд' },
    { key: 'projects', title: 'Проекты' },
  ];

  /**
   * Открытая вкладка живёт в адресе, а не в памяти компонента.
   *
   * Дашборд заказчик показывает начальству и даёт на него ссылку — а
   * ссылка, открывающаяся списком проектов, показывает не то, чем
   * делились. По той же причине в адресе живёт и окно дашборда.
   */
  public readonly tab = signal<CabinetTab>('dashboard');

  public readonly loading = signal(true);

  public readonly projects = signal<ProjectClientView[]>([]);

  /**
   * Заголовок страницы — про РЕЗУЛЬТАТ, а не про раздел.
   *
   * «Мои проекты» называло место, в которое человек уже пришёл, и не
   * говорило ничего. Этот экран показывают начальству и вставляют в
   * коммерческое предложение: первая строка в нём обязана отвечать на
   * вопрос, с которым его открыли.
   *
   * Имя подставляется, когда оно есть. Без имени фраза остаётся
   * осмысленной — «Что вы получили за свои деньги», — а не превращается
   * в «Что  получил за свои деньги» с дырой посередине.
   */
  public readonly headline = computed(() => {
    const name = this.contacts().display_name.trim();
    if (this.tab() === 'projects') return name ? `Проекты ${name}` : 'Ваши проекты';
    return name ? `Что ${name} получил за свои деньги` : 'Что вы получили за свои деньги';
  });

  /**
   * Проекты ПО ВОРОНКЕ: стадии, шаги и согласования.
   *
   * Отдельно от реестра намеренно. У проекта с креаторами есть ролики,
   * площадки и цена тысячи, и строка реестра говорит о нём числами; у
   * проекта по воронке ничего этого нет вовсе, и в реестре он стоял бы
   * пустой строкой. Проценты, которые у него есть, меряют шаги
   * согласования — и ровно поэтому их больше нет там, где они ничего не
   * меряли.
   */
  public readonly funnelProjects = computed(() =>
    this.projects().filter((p) => p.kind !== 'creators_turnkey'),
  );

  /** Заказы, которые ещё в работе: по ним воронка не закончена. */
  public readonly activeOrders = signal<Order[]>([]);

  public readonly contacts = signal<ClientProfile>({
    user_id: '',
    display_name: '',
    phone: '',
    telegram: '',
  });

  public readonly contactsSaving = signal(false);

  public readonly contactsExpanded = signal(false);

  // ngModel-friendly доступ
  public get displayName(): string {
    return this.contacts().display_name;
  }
  public set displayName(v: string) {
    this.contacts.set({ ...this.contacts(), display_name: v });
  }
  public get phone(): string {
    return this.contacts().phone;
  }
  public set phone(v: string) {
    this.contacts.set({ ...this.contacts(), phone: v });
  }
  public get telegram(): string {
    return this.contacts().telegram;
  }
  public set telegram(v: string) {
    this.contacts.set({ ...this.contacts(), telegram: v });
  }

  public toggleContacts(): void {
    this.contactsExpanded.set(!this.contactsExpanded());
  }

  /**
   * Контакты считаются заполненными, только если есть способ связаться:
   * телефон или телеграм. Одного имени мало — раньше блок сворачивался и
   * рапортовал «заполнены», а менеджер по такой заявке дозвониться не мог.
   * Имя тем более подставляется из регистрации автоматически.
   */
  public contactsFilled(): boolean {
    const c = this.contacts();
    return !!(c.phone?.trim() || c.telegram?.trim());
  }

  public contactsPreview(): string {
    const c = this.contacts();
    return [c.display_name, c.phone || c.telegram].filter(Boolean).join(' · ');
  }

  public saveContacts(): void {
    this.contactsSaving.set(true);
    const c = this.contacts();
    this.profileApi
      .patch({
        display_name: c.display_name,
        phone: c.phone,
        telegram: c.telegram,
      })
      .subscribe({
        next: (cp) => {
          this.contacts.set(cp);
          this.contactsSaving.set(false);
          this.msg.success('Контакты сохранены');
        },
        error: () => {
          this.contactsSaving.set(false);
          this.msg.error('Не удалось сохранить');
        },
      });
  }

  public label(s: ProjectClientView['display_status']): string {
    return PROJECT_STATUS_LABEL[s];
  }

  public color(s: ProjectClientView['display_status']): string {
    return PROJECT_STATUS_COLOR[s];
  }

  public setTab(t: CabinetTab): void {
    if (t === this.tab()) return;
    void this.router.navigate([], {
      relativeTo: this.route,
      // В адресе живёт только НЕ умолчание: ссылка на дашборд — это
      // просто /me/projects, а не /me/projects?tab=dashboard.
      queryParams: { tab: t === 'dashboard' ? null : t },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  public constructor() {
    // Подписка, а не разовое чтение: «назад» в браузере обязан вернуть
    // ту вкладку, с которой ушли.
    this.route.queryParamMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((q) => {
      this.tab.set(q.get('tab') === 'projects' ? 'projects' : 'dashboard');
    });
    this.api.listClientProjects().subscribe({
      next: (resp) => {
        this.projects.set(resp.items);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
    this.profileApi.get().subscribe({
      next: (cp) => {
        this.contacts.set(cp);
        // Нет способа связи — раскрываем блок: заявка без телефона или
        // телеграма для менеджера бесполезна.
        if (!this.contactsFilled()) this.contactsExpanded.set(true);
      },
    });
    // Незаконченный заказ важнее кнопки «Под ключ»: без него человек
    // заведёт второй такой же и будет ждать ответы по обоим.
    this.orderApi.listOrders().subscribe({
      next: (r) =>
        this.activeOrders.set(
          r.items.filter((o) => o.status !== 'cancelled' && o.status !== 'paid'),
        ),
      // Молча: воронка — не главное на этой странице, и сообщение об
      // ошибке заказов поверх списка проектов только пугает.
      error: () => this.activeOrders.set([]),
    });
  }

  public open(p: ProjectClientView): void {
    void this.router.navigate(['/me/projects', p.id], withFromPage(this.router));
  }

  public startTurnkey(): void {
    void this.router.navigate(['/me/orders/new'], withFromPage(this.router));
  }

  public openOrder(id: string): void {
    void this.router.navigate(['/me/orders', id], withFromPage(this.router));
  }

  /**
   * Подпись к незаконченному заказу: человек должен понимать, зачем туда
   * возвращаться. «Продолжить» без состояния выглядит как второй заказ.
   */
  public orderStatusLabel(o: Order): string {
    if (o.status === 'staffed') return 'состав собран';
    if (o.status === 'draft') return 'приглашения не ушли';
    return `ждём ответы, ${o.accepted} из ${o.needed}`;
  }
}
