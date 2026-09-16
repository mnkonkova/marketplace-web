import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  input,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { distinctUntilChanged, map } from 'rxjs';

import { BillingApi } from '@entities/billing/api/billing.api';
import { formatMoney } from '@entities/billing/lib/money';
import { periodDay, periodRange } from '@entities/billing/lib/period';
import { shortViews } from '@entities/billing/lib/ladder';
import { parseRange } from '@entities/billing/lib/overview';
import type {
  ClientOverview,
  OverviewProject,
  OverviewRange,
} from '@entities/billing/model/billing.types';
import { clientTitle } from '@entities/project/lib/project-title';
import { plural } from '@shared/lib/format';
import { NodataComponent } from '@shared/ui/nodata/nodata.component';
import { ClientDashboardComponent } from '@widgets/client-dashboard/client-dashboard.component';

/**
 * Сводка заказчика по всем проектам сразу.
 *
 * До неё всё считалось внутри одного проекта, и заказчик с тремя
 * проектами складывал числа в уме или в табличке. Главный вопрос этого
 * экрана в проекте по отдельности не имеет ответа вовсе: «во сколько мне
 * обходится тысяча просмотров».
 *
 * Экран разложен на два разговора, и они НЕ смешиваются:
 *
 *  • Сверху — дашборд за выбранное окно: сколько посмотрели, откуда и
 *    как откликнулись. Это то, что показывают начальству, и там у
 *    каждого числа в подписи стоит период.
 *  • Ниже — рост и проекты за ВСЁ ВРЕМЯ: как набирался объём и что
 *    вышло по каждому проекту. Эти числа не должны скакать при
 *    переключении окна — вопрос «что у меня всего» от окна не зависит.
 *
 * Цена тысячи просмотров — главное коммерческое число — живёт плиткой
 * в дашборде, среди прочих KPI. Второй её копии здесь нет намеренно:
 * два места для одного числа расходятся на первой же правке.
 *
 * Оконное число рядом с общим без подписи человек складывает в одно, и
 * получается величина, которой нет нигде, — поэтому подписи здесь не
 * украшение, а часть смысла.
 *
 * Слово «охват» не встречается ни разу, и это не придирка к словам: мы
 * считаем ПРОСМОТРЫ, а на различии «показ против просмотра» построена
 * вся коммерческая аргументация. Назвать одно другим — обещать то, чего
 * мы не собираем.
 *
 * Ничего не считаем сами: суммы, стоимость тысячи, доли и ряды приходят
 * с сервера готовыми. Складывать их заново значило бы получить на двух
 * экранах два разных числа.
 */
@Component({
  selector: 'app-client-overview',
  standalone: true,
  imports: [CommonModule, RouterLink, NodataComponent, ClientDashboardComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './client-overview.component.html',
  styleUrls: ['./client-overview.component.scss', './client-overview.component.touch.scss'],
})
export class ClientOverviewComponent {
  private readonly api = inject(BillingApi);

  private readonly route = inject(ActivatedRoute);

  private readonly router = inject(Router);

  private readonly destroyRef = inject(DestroyRef);

  /** Имя заказчика для шапки дашборда. Страница его уже загрузила. */
  public readonly clientName = input('');

  /**
   * Показывать ли сам дашборд.
   *
   * Реестр проектов нужен обеим вкладкам кабинета: под дашбордом — как
   * проход в проект одним кликом, во вкладке «Проекты» — как весь её
   * список. Числа в нём одни и те же и приходят одним ответом, поэтому
   * и рисует их один компонент: вторая копия строки реестра разошлась бы
   * с первой на ближайшей правке.
   */
  public readonly withDashboard = input(true);

  public readonly loading = signal(true);

  public readonly data = signal<ClientOverview | null>(null);

  /**
   * Не доехало — блока просто нет.
   *
   * Сводка стоит НАД проектами, и красная плашка поверх списка пугает
   * сильнее, чем помогает: сами проекты при этом открываются и работают.
   */
  public readonly failed = signal(false);

  /**
   * Выбранное окно.
   *
   * Живёт в адресе, а не в памяти вкладки: этот экран показывают
   * начальству и на него дают ссылку, а ссылка на «квартал» обязана
   * открыться кварталом. Заодно работают «назад» и «вперёд» в браузере.
   */
  public readonly range = signal<OverviewRange>('month');

  public readonly money = formatMoney;

  public readonly views = shortViews;

  public constructor() {
    // Подписка, а не разовое чтение снимка: окно меняется навигацией, и
    // назад по истории обязано вернуть прошлое окно вместе с числами.
    this.route.queryParamMap
      .pipe(
        map((q) => parseRange(q.get('range'))),
        distinctUntilChanged(),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((r) => {
        this.range.set(r);
        this.load(r);
      });
  }

  /** Переключение окна — это навигация: окно живёт в адресе. */
  public setRange(r: OverviewRange): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { range: r },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  private load(r: OverviewRange): void {
    this.loading.set(true);
    this.api.clientOverview(r).subscribe({
      next: (resp) => {
        this.data.set(resp);
        this.failed.set(false);
        this.loading.set(false);
      },
      error: () => {
        this.failed.set(true);
        this.loading.set(false);
      },
    });
  }

  public plural(n: number, one: string, few: string, many: string): string {
    return plural(n, one, few, many);
  }

  /** Показывать сводку есть смысл, только когда есть хоть один проект. */
  public readonly hasProjects = computed(() => (this.data()?.projects_total ?? 0) > 0);

  /**
   * Реестр проектов — ВСЕ, а не только завершённые.
   *
   * Раньше здесь стоял блок «Итоги по завершённым проектам»: та же
   * тройка «просмотры · счёт · цена тысячи», только по половине
   * проектов и другой вёрсткой, а идущие лежали в другой вкладке и
   * показывали проценты воронки вместо просмотров. Вопрос у обоих
   * списков один, и список должен быть один.
   *
   * Идущие первыми: незаконченный проект — то, о чём спрашивают сегодня,
   * а сданный смотрят, когда приходят за следующим заказом. Внутри
   * состояния — по объёму: строка, которую показывают начальству,
   * начинается с самой убедительной.
   *
   * Состояние приходит с сервера: выводить завершённость в браузере по
   * косвенным приметам значило бы завести вторую, расходящуюся правду.
   */
  public readonly projects = computed(() => {
    const order: Record<string, number> = { running: 0, not_started: 1, completed: 2 };
    return [...(this.data()?.projects ?? [])].sort(
      (a, b) => (order[a.state] ?? 3) - (order[b.state] ?? 3) || b.views - a.views,
    );
  });

  /**
   * Заголовок реестра.
   *
   * Под дашбордом это второй блок экрана, и он себя называет; во вкладке
   * «Проекты» он ВЕСЬ экран, и второй заголовок под заголовком страницы
   * был бы эхом.
   */
  public readonly registryTitle = computed(() => (this.withDashboard() ? 'Проекты' : ''));

  /**
   * Что стоит под названием проекта: настоящий период и его состояние.
   *
   * Период отсчитывается от первой публикации — не от календаря и не от
   * заведения проекта, — поэтому подписан датами. У не начавшегося
   * проекта периода нет вовсе, и выдуманный тут хуже отсутствующего: по
   * нему начинают считать сроки.
   */
  public periodOf(p: OverviewProject): string {
    if (p.state === 'completed' && p.completed_at) {
      return `Сдан ${periodDay(p.completed_at, true)}`;
    }
    const period = p.period;
    if (!period) return 'Период начнётся с первого вышедшего ролика';
    return `Период ${period.seq} · ${periodRange(period)}`;
  }

  /**
   * Название проекта для реестра — без служебных пометок конвейера.
   *
   * «(e2e)», «(тест)», «(копия)» — наши, а не заказчика, и в реестре,
   * который стоит на первом экране кабинета, читаются как недоделка.
   * Правило одно на реестр и на шапку карточки: см. clientTitle.
   */
  public readonly titleOf = clientTitle;

  /** Состояние проекта словом. Три разных, и путать их нельзя. */
  public stateLabel(p: OverviewProject): string {
    if (p.state === 'completed') return 'Сдан';
    return p.state === 'running' ? 'Идёт' : 'Готовится';
  }

  // Графика здесь нет намеренно.
  //
  // «Как растут просмотры» переехал в дашборд — туда, где стоит число,
  // которое он объясняет, — и стал накопительным с разбором по
  // площадкам. В блоке итогов он рисовал ПРИРОСТ за всё время: другая
  // величина под похожим заголовком, в двух экранах прокрутки от своего
  // числа.
}
