import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { forkJoin } from 'rxjs';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzDatePickerModule } from 'ng-zorro-antd/date-picker';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { NzInputModule } from 'ng-zorro-antd/input';
import { NzMessageService } from 'ng-zorro-antd/message';
import { NzModalModule } from 'ng-zorro-antd/modal';
import { NzSpinModule } from 'ng-zorro-antd/spin';
import { NzTagModule } from 'ng-zorro-antd/tag';

import { PublicationApi } from '@entities/publication/api/publication.api';
import {
  ALL_PLATFORMS,
  ChecklistItem,
  CreatorProjectCard,
  Platform,
  Publication,
  PublicationReport,
} from '@entities/publication/model/publication.types';
import {
  PLATFORM_LABEL,
  PLATFORM_SHORT,
  canSubmitLinks,
  closedCount,
  daysLeft,
  dueLabel,
  linkFor,
  linksCollected,
  missingPlatforms,
  publicationBadge,
} from '@entities/publication/lib/publication-status';
import {
  commonItems,
  itemsForPlatform,
  requiredUnchecked,
} from '@entities/publication/lib/checklist';
import {
  isDisabledDay,
  isSelfAdded,
  takenOn,
  ymdLocal,
} from '@entities/publication/lib/extra-publication';
import { projectBlocks } from '@entities/publication/lib/project-blocks';
import { AuthSessionStore } from '@entities/auth/model/auth-session.store';
import { CreatorAvailabilityComponent } from '@widgets/creator-availability/creator-availability.component';
import { CreatorLadderComponent } from '@widgets/creator-ladder/creator-ladder.component';
import { BillingApi } from '@entities/billing/api/billing.api';
import type { CreatorEarnings } from '@entities/billing/model/billing.types';
import { formatMoney } from '@entities/billing/lib/money';
import { periodDay, periodOf, periodTitle } from '@entities/billing/lib/period';
import type { Material } from '@entities/publication/model/publication.types';
import { parseApiError } from '@shared/api/api-error';
import { plural } from '@shared/lib/format';
import { AppHeaderComponent } from '@widgets/app-header/app-header.component';
import { ProjectCommentsComponent } from '@widgets/project-comments/project-comments.component';
import { ErValueComponent } from '@shared/ui/er-value/er-value.component';

// Страница проекта глазами креатора: карточка проекта, его выкладки,
// чеклист, материалы, заработок и цифры по его же роликам. Шапка берётся
// из GET /me/creator/projects/{id} — там есть и бриф, и период, и месячный
// план, и кому писать; собирать её из списка выкладок больше не нужно.
@Component({
  selector: 'app-creator-project-page',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    RouterLink,
    NzButtonModule,
    NzDatePickerModule,
    NzIconModule,
    NzInputModule,
    NzModalModule,
    NzSpinModule,
    NzTagModule,
    AppHeaderComponent,
    CreatorAvailabilityComponent,
    CreatorLadderComponent,
    ProjectCommentsComponent,
    ErValueComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './creator-project.page.html',
  styleUrl: './creator-project.page.scss',
})
export class CreatorProjectPage {
  private readonly api = inject(PublicationApi);

  private readonly billing = inject(BillingApi);

  private readonly route = inject(ActivatedRoute);

  private readonly msg = inject(NzMessageService);

  // Свой id — чтобы в переписке свои сообщения были подписаны «Вы».
  public readonly meId = inject(AuthSessionStore).userId;

  public readonly platformLabel = PLATFORM_LABEL;

  public readonly platformShort = PLATFORM_SHORT;

  /** Суммы приходят в копейках: на экран — рублями. */
  public readonly money = formatMoney;

  public readonly loading = signal(true);

  public readonly projectId = signal('');

  public readonly card = signal<CreatorProjectCard | null>(null);

  /**
   * Проекта нет или мы не в его составе.
   *
   * Раньше 404 по карточке просто гасился, и человек видел обычную
   * страницу с нулями: «выкладок пока нет — менеджер ещё не проставил
   * даты». По чужому проекту это неправда, а по несуществующему —
   * вдвойне.
   */
  public readonly notFound = signal(false);

  public readonly items = signal<Publication[]>([]);

  public readonly checklist = signal<ChecklistItem[]>([]);

  public readonly report = signal<PublicationReport | null>(null);

  /**
   * Тариф и заработок. В макете ставки стоят строкой в шапке проекта, а
   * деньги — карточкой справа, поэтому страница берёт их сама, а не
   * прячет в отдельный виджет: разорванные по компонентам, они и
   * загружались бы дважды.
   */
  public readonly earnings = signal<CreatorEarnings | null>(null);

  /**
   * Какому периоду принадлежит строка заработка.
   *
   * Строка знает только дату начала своего периода, а «с какого по
   * какое» лежит в списке периодов из того же ответа. Не нашлось —
   * показываем саму дату: достраивать границы прибавлением месяца
   * нельзя, правило периода живёт на сервере.
   */
  public periodOfAccrual(periodStart: string): string {
    return periodTitle(periodOf(this.earnings()?.periods ?? [], periodStart));
  }

  /** Текущий период — его границы и состояние. */
  public readonly period = computed(() => this.earnings()?.period ?? null);

  /** Конец текущего периода: «до 12 окт.» в подписи плана. */
  public readonly periodEnds = computed(() => this.period()?.ends_on ?? null);

  /**
   * Прошлые начисления — история.
   *
   * Текущий период показывает шкала сверху, крупно и с прогнозом. Второй
   * такой же блок рядом был бы не «подробнее», а дублем: одна и та же
   * сумма дважды на одном экране.
   */
  public readonly pastAccruals = computed(() => {
    const cur = this.period()?.starts_on.slice(0, 10);
    return (this.earnings()?.accruals ?? []).filter(
      (a) => !cur || a.period_start.slice(0, 10) !== cur,
    );
  });

  /** Материалы проекта: бренд-гайд, обучение, ссылки на аккаунты. */
  public readonly materials = signal<Material[]>([]);

  // Отчёт закрытого проекта: 410 collapsed_no_detail. Не ошибка, а
  // состояние — показываем текстом вместо цифр.
  public readonly reportCollapsed = signal(false);

  public readonly busy = signal(false);

  public constructor() {
    const id = this.route.snapshot.paramMap.get('id');
    if (id) {
      this.projectId.set(id);
      this.fetch(id);
    } else {
      this.loading.set(false);
    }
  }

  // Выкладки в порядке дедлайна: номер «Выкладка 03» — это позиция в
  // расписании, отдельного поля с номером или темой ролика в API нет.
  //
  // Отменённые не показываем: их сняли с плана, сдавать по ним нечего, а
  // в списке они путали нумерацию и создавали пары «та же дата, но одна
  // отменена».
  public readonly ordered = computed(() =>
    this.items()
      .filter((p) => p.status !== 'cancelled')
      .sort((a, b) => a.due_date.localeCompare(b.due_date)),
  );

  public readonly closed = computed(() => closedCount(this.items()));

  public readonly total = computed(
    () => this.items().filter((p) => p.status !== 'cancelled').length,
  );

  public readonly links = computed(() => linksCollected(this.items()));

  // Что показывать: карта блоков по роли. У креатора нет ни ленты, ни
  // календаря, ни настроек уведомлений — соответствующих ручек в API нет.
  // Вид проекта берём из карточки: догадка по наличию выкладок убрана.
  public readonly blocks = computed(() =>
    projectBlocks('creator', {
      kind: this.card()?.kind ?? 'creators_turnkey',
      statsAllowed: !this.reportCollapsed(),
    }),
  );

  // Площадки ролика: список приходит с карточкой, чтобы у фронта не было
  // своей копии порядка колонок. До ответа держим свой — иначе таблица
  // ссылок при загрузке схлопывается в пустоту.
  public readonly projectPlatforms = computed<readonly Platform[]>(
    () => this.card()?.platforms ?? ALL_PLATFORMS,
  );

  // «6 из 12» в шапке: план месяца из договора. Без карточки его взять
  // было неоткуда, и знаменателем стояло число проставленных выкладок.
  public readonly monthlyPlan = computed(() => this.card()?.monthly_plan ?? 0);

  // Самая горящая открытая выкладка: сначала просроченные, потом ближайшая
  // по сроку. Её и показывает баннер в шапке.
  public readonly urgent = computed(() => {
    const open = this.ordered().filter((p) => canSubmitLinks(p));
    return open.find((p) => p.overdue) ?? open[0] ?? null;
  });

  /**
   * Доли полосы прогресса. Считаются по выкладкам, а не по ссылкам:
   * закрывается ролик целиком, и полоса должна отвечать на вопрос
   * «сколько роликов сдано», а не «сколько ссылок собрано».
   */
  public sharePercent(part: 'done' | 'part' | 'late'): number {
    const all = this.ordered();
    if (!all.length) return 0;
    const n = all.filter((p) => {
      const tone = publicationBadge(p).tone;
      if (part === 'done') return tone === 'ok';
      if (part === 'late') return tone === 'late';
      return p.links.length > 0 && tone !== 'ok' && tone !== 'late';
    }).length;
    return (n / all.length) * 100;
  }

  /** Сколько дней до срока; отрицательное — просрочка. */
  public daysLeft(pub: Publication): string {
    const days = this.daysDiff(pub);
    return days < 0 ? `−${Math.abs(days)}` : String(days);
  }

  // Форма слова — общим хелпером: своя копия правила здесь уже была
  // третьей в репозитории, и все три пришлось бы чинить порознь.
  public daysWord(pub: Publication): string {
    return plural(this.daysDiff(pub), 'день', 'дня', 'дней');
  }

  public plural(n: number, one: string, few: string, many: string): string {
    return plural(n, one, few, many);
  }

  private daysDiff(pub: Publication): number {
    const due = new Date(pub.due_date);
    const today = new Date();
    due.setHours(0, 0, 0, 0);
    today.setHours(0, 0, 0, 0);
    return Math.round((due.getTime() - today.getTime()) / 86_400_000);
  }

  /** «ни одной ссылки» / «собрано 3 из 5» — то, что видно в баннере. */
  public collectedLabel(pub: Publication): string {
    const have = pub.links.length;
    const all = this.projectPlatforms().length;
    return have ? `собрано ${have} из ${all}` : 'ни одной ссылки';
  }

  public urgentHint(pub: Publication): string {
    const when = dueLabel(pub.due_date);
    return pub.overdue
      ? `Надо было выложить ${when}. Сдайте ссылки или попросите новую дату.`
      : `Выложить ${when}. Можно сдать не все площадки сразу.`;
  }

  /** Ссылка в строке площадки — без схемы: она везде одна и та же. */
  public shortUrl(url: string): string {
    return url.replace(/^https?:\/\//, '').replace(/^www\./, '');
  }

  public materialShort(kind: string): string {
    if (kind === 'video') return 'MP4';
    if (kind === 'link') return 'URL';
    return 'DOC';
  }

  /** Переписка внизу страницы: кнопка «Написать» ведёт туда же. */
  public scrollToTalk(): void {
    document.getElementById('talk')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  public index(pub: Publication): string {
    const i = this.ordered().findIndex((p) => p.id === pub.id);
    return String(i + 1).padStart(2, '0');
  }

  public badge(pub: Publication) {
    return publicationBadge(pub);
  }

  public due(date: string): string {
    return dueLabel(date);
  }

  public isLate(date: string): boolean {
    return daysLeft(date) < 0;
  }

  public link(pub: Publication, platform: Platform) {
    return linkFor(pub, platform);
  }

  public missing(pub: Publication): Platform[] {
    return missingPlatforms(pub);
  }

  public canSubmit(pub: Publication): boolean {
    return canSubmitLinks(pub);
  }

  public readonly expanded = signal<Set<string>>(new Set());

  public toggle(pub: Publication): void {
    const next = new Set(this.expanded());
    if (next.has(pub.id)) next.delete(pub.id);
    else next.add(pub.id);
    this.expanded.set(next);
  }

  public isExpanded(pub: Publication): boolean {
    return this.expanded().has(pub.id);
  }

  // Сумма по всем площадкам ролика приходит в самой выкладке — складывать
  // её из videos_table значило бы держать вторую реализацию правила, по
  // которому считается порог «миллион на ролик».
  public statsOf(
    pub: Publication,
  ): { views: number; likes: number; er?: number; erWithoutShares: boolean } | null {
    if (!pub.links.length) return null;
    // ER берём у сервера: он считает (лайки + комментарии + репосты) ÷
    // просмотры. Своя формула из лайков здесь уже расходилась с отчётом
    // на тех же роликах, а с приходом репостов разошлась бы сильнее.
    return {
      views: pub.views,
      likes: pub.likes,
      er: pub.er_percent,
      erWithoutShares: !!pub.er_without_shares,
    };
  }

  public viewsOf(pub: Publication, platform: Platform): number | null {
    const rep = this.report();
    if (!rep) return null;
    const row = rep.videos_table.find(
      (r) => r.publication_id === pub.id && r.platform === platform,
    );
    return row ? row.views : null;
  }

  // ---- сдача ссылок ----

  public readonly submitFor = signal<Publication | null>(null);

  public readonly urls = signal<Record<Platform, string>>(this.emptyUrls());

  public readonly checked = signal<Set<string>>(new Set());

  // Пункты, которые бэк назвал незакрытыми в 422 checklist_incomplete:
  // подсвечиваем именно их, а не весь список.
  public readonly flagged = signal<Set<string>>(new Set());

  public readonly commonChecklist = computed(() => commonItems(this.checklist()));

  /**
   * У проекта нет ни одного пункта чеклиста.
   *
   * Отдельное состояние, а не пустой список. Чеклист снимается с шаблона
   * в момент заведения проекта; шаблон не подключили — пунктов нет
   * вовсе, и окно сдачи молча открывалось без единого требования.
   * Молчание тут читается двумя способами сразу, и оба вредные: креатор
   * решит, что требований нет, а менеджер — что тот их проигнорировал.
   */
  public readonly noChecklist = computed(() => this.checklist().length === 0);

  public itemsFor(platform: Platform): ChecklistItem[] {
    return itemsForPlatform(this.checklist(), platform);
  }

  private emptyUrls(): Record<Platform, string> {
    return { tiktok: '', instagram: '', youtube: '', vk: '', likee: '' };
  }

  /**
   * Название ролика.
   *
   * Тему выкладки задаёт дата, и до съёмки названия нет. После — оно
   * единственное, по чему ролик можно отличить: в ленте заказчика иначе
   * двенадцать строк «Выкладка 07». Знает его только тот, кто снимал.
   */
  public title = '';

  public openSubmit(pub: Publication): void {
    this.submitFor.set(pub);
    // Досылая площадки, креатор видит то, что вписал в первый заход.
    this.title = pub.title ?? '';
    const filled = this.emptyUrls();
    for (const l of pub.links) filled[l.platform] = l.url;
    this.urls.set(filled);
    this.checked.set(new Set());
    this.flagged.set(new Set());
  }

  public closeSubmit(): void {
    this.submitFor.set(null);
  }

  public urlValue(platform: Platform): string {
    return this.urls()[platform];
  }

  public setUrl(platform: Platform, value: string): void {
    this.urls.set({ ...this.urls(), [platform]: value });
  }

  public toggleItem(item: ChecklistItem): void {
    const next = new Set(this.checked());
    if (next.has(item.id)) next.delete(item.id);
    else next.add(item.id);
    this.checked.set(next);
    if (this.flagged().has(item.id)) {
      const f = new Set(this.flagged());
      f.delete(item.id);
      this.flagged.set(f);
    }
  }

  public isChecked(item: ChecklistItem): boolean {
    return this.checked().has(item.id);
  }

  public isFlagged(item: ChecklistItem): boolean {
    return this.flagged().has(item.id);
  }

  // Площадки, которые сейчас сдаются: только те, где поле не пустое и
  // ссылки ещё не было.
  public readonly submittingPlatforms = computed<Platform[]>(() => {
    const pub = this.submitFor();
    if (!pub) return [];
    const already = new Set(pub.links.map((l) => l.platform));
    const filled = this.urls();
    return ALL_PLATFORMS.filter((p) => !already.has(p) && filled[p].trim().length > 0);
  });

  public readonly blockingItems = computed(() =>
    requiredUnchecked(this.checklist(), this.submittingPlatforms(), this.checked()),
  );

  public readonly submitHint = computed(() => {
    if (!this.submittingPlatforms().length) return 'Вставьте хотя бы одну новую ссылку.';
    const left = this.blockingItems().length;
    if (left) return `Не отмечено обязательных пунктов: ${left}.`;
    return `Сдаём ${this.submittingPlatforms().length} из ${ALL_PLATFORMS.length} площадок.`;
  });

  public readonly canSend = computed(
    () => this.submittingPlatforms().length > 0 && this.blockingItems().length === 0,
  );

  public send(): void {
    const pub = this.submitFor();
    if (!pub || !this.canSend()) return;
    const urls = this.submittingPlatforms().map((p) => this.urls()[p].trim());
    this.busy.set(true);
    this.api.creatorSubmitLinks(pub.id, urls, [...this.checked()], this.title.trim()).subscribe({
      next: (saved) => {
        this.busy.set(false);
        this.submitFor.set(null);
        this.items.set(this.items().map((p) => (p.id === saved.id ? saved : p)));
        this.msg.success(
          saved.status === 'done'
            ? 'Ролик закрыт — приняты все площадки, статистика подтянется утром.'
            : `Принято ${saved.links.length} из ${ALL_PLATFORMS.length} — остальные можно дослать позже.`,
        );
        this.reloadReport();
      },
      error: (e) => {
        this.busy.set(false);
        const err = parseApiError(e, 'Не удалось сдать ссылки.');
        // 422: message перечисляет незакрытые пункты — подсвечиваем их и
        // оставляем окно открытым.
        if (err.code === 'checklist_incomplete') {
          this.flagged.set(new Set(this.matchItemsFromMessage(err.message)));
          this.msg.error(err.message);
          return;
        }
        // 409: выкладку закрыли, пока окно было открыто. Перечитываем —
        // кнопка сдачи после этого исчезнет сама.
        if (err.code === 'publication_closed') {
          this.submitFor.set(null);
          this.msg.error(err.message);
          this.fetch(this.projectId(), true);
          return;
        }
        this.msg.error(err.message);
      },
    });
  }

  // Бэк перечисляет незакрытые пункты текстом. Сопоставляем по тексту
  // пункта: id в сообщении нет.
  private matchItemsFromMessage(message: string): string[] {
    return this.checklist()
      .filter((i) => i.is_required && message.includes(i.text))
      .map((i) => i.id);
  }

  // ---- просьба о переносе ----

  public readonly dateFor = signal<Publication | null>(null);

  /**
   * Новая дата — объектом, а не строкой: поле теперь nz-date-picker.
   *
   * Было `<input type="date">` — единственное нативное поле даты во всём
   * приложении. Chrome рисует у него свой календарь: белый, с синим
   * выделением, мимо всей тёмной темы, и выключить это нельзя.
   */
  public newDate: Date | null = null;

  public dateReason = '';

  /** Задним числом дату не просят: перенос бывает только вперёд. */
  public readonly disabledPastDates = (current: Date): boolean => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return current.getTime() < today.getTime();
  };

  public openDateRequest(pub: Publication): void {
    this.dateFor.set(pub);
    this.newDate = null;
    this.dateReason = '';
  }

  public closeDateRequest(): void {
    this.dateFor.set(null);
  }

  public sendDateRequest(): void {
    const pub = this.dateFor();
    if (!pub) return;
    if (!this.newDate) {
      this.msg.error('Укажите новую дату выкладки.');
      return;
    }
    if (!this.dateReason.trim()) {
      this.msg.error('Напишите, что случилось — без причины менеджер не поймёт.');
      return;
    }
    this.busy.set(true);
    // ГГГГ-ММ-ДД в локальном времени: toISOString сдвигает дату на UTC,
    // и в плюсовых поясах просьба уезжала бы на день назад.
    const requested = ymdLocal(this.newDate);
    this.api.creatorRequestDate(pub.id, requested, this.dateReason.trim()).subscribe({
      next: () => {
        this.busy.set(false);
        this.dateFor.set(null);
        this.msg.success('Запрос ушёл менеджеру. Пока он не ответил, выкладка не просрочена.');
        this.fetch(this.projectId(), true);
      },
      error: (e) => {
        this.busy.set(false);
        const err = parseApiError(e, 'Не удалось отправить запрос.');
        if (err.code === 'already_requested') {
          this.dateFor.set(null);
          this.fetch(this.projectId(), true);
        }
        this.msg.error(err.message);
      },
    });
  }

  // ---- своя выкладка сверх плана ----
  //
  // План ставит менеджер. Эта кнопка про другое: план периода выполнен, а
  // до ступени не хватило, и добрать нечем — новых дат впереди нет.
  //
  // Поэтому первым в окне стоит не поле даты, а правило про оклад:
  // недосдача считается только по плановым выкладкам, добавить и не
  // сдать — не штрафуется. Без этой фразы кнопку не нажмут, и правильно
  // сделают: в чужих системах такое обычно наказывается.

  public readonly addOpen = signal(false);

  /** Дата новой выкладки. Сигнал, а не поле: от неё зависят проверки. */
  public readonly addDate = signal<Date | null>(null);

  /**
   * Прошлое и «дальше года вперёд» календарь не отдаёт.
   *
   * Те же границы держит сервер (400 invalid_input), и это не дубль
   * правила, а его место: отказ, прилетевший на день, который пикер
   * показал выбираемым, человек относит к сбою, а не к своей дате.
   */
  public readonly disabledAddDates = (current: Date): boolean => isDisabledDay(current);

  /**
   * Своя выкладка на выбранный день уже есть.
   *
   * Сервер ответит тем же (409 day_taken), но сказать это можно сразу и
   * прямо в окне: список своих выкладок у страницы уже загружен.
   */
  public readonly addTaken = computed(() => {
    const d = this.addDate();
    return d ? takenOn(this.items(), ymdLocal(d)) : null;
  });

  /** Сколько в чеклисте обязательных пунктов — их не обойти при сдаче. */
  public readonly requiredItems = computed(
    () => this.checklist().filter((i) => i.is_required).length,
  );

  public readonly canAdd = computed(() => !!this.addDate() && !this.addTaken());

  public openAddPublication(): void {
    this.addDate.set(null);
    this.addOpen.set(true);
  }

  public closeAddPublication(): void {
    this.addOpen.set(false);
  }

  /** Выкладку завёл себе сам креатор, а не поручил менеджер. */
  public selfAdded(pub: Publication): boolean {
    return isSelfAdded(pub);
  }

  public addPublication(): void {
    const d = this.addDate();
    if (!d || !this.canAdd()) return;
    this.busy.set(true);
    this.api.creatorAddPublication(this.projectId(), ymdLocal(d)).subscribe({
      next: (created) => {
        this.busy.set(false);
        this.addOpen.set(false);
        this.items.set([...this.items(), created]);
        this.msg.success('Выкладка добавлена. Сдадите ссылки, когда ролик выйдет.');
      },
      error: (e) => {
        this.busy.set(false);
        // Текст отказа берём у сервера: он знает и про занятый день, и
        // про подытоженный период, и про состав проекта. Свой пересказ
        // разошёлся бы с ним на первой же правке правил.
        const err = parseApiError(e, 'Не удалось добавить выкладку.');
        // День заняли, пока окно было открыто (например, в соседней
        // вкладке). Перечитываем список — предупреждение про занятый
        // день встанет на место само.
        if (err.code === 'day_taken') this.fetch(this.projectId(), true);
        this.msg.error(err.message);
      },
    });
  }

  // ---- загрузка ----

  private reloadReport(): void {
    this.api.creatorReport(this.projectId()).subscribe({
      next: (r) => this.report.set(r),
      error: () => undefined,
    });
  }

  private fetch(id: string, quiet = false): void {
    if (!quiet) this.loading.set(true);
    this.api.creatorProjectCard(id).subscribe({
      next: (c) => {
        this.card.set(c);
        this.notFound.set(false);
      },
      // Карточки нет — значит проекта нет или мы не в его составе.
      // Показываем это прямо, а не пустую страницу с нулями.
      error: (e) => {
        this.card.set(null);
        this.notFound.set(parseApiError(e, '').code === 'not_found');
      },
    });
    forkJoin({
      pubs: this.api.creatorList(id),
      checklist: this.api.creatorChecklist(id),
    }).subscribe({
      next: ({ pubs, checklist }) => {
        this.items.set(pubs.items);
        this.checklist.set([...checklist.items].sort((a, b) => a.sort_order - b.sort_order));
        this.loading.set(false);
      },
      error: (e) => {
        this.loading.set(false);
        // Если проекта нет, про это уже сказано на самой странице —
        // второе сообщение поверх было бы шумом об одной причине.
        if (!this.notFound()) {
          this.msg.error(parseApiError(e, 'Не удалось загрузить выкладки.').message);
        }
      },
    });
    this.api.creatorMaterials(id).subscribe({
      next: (r) => this.materials.set(r.items),
      error: () => this.materials.set([]),
    });
    this.billing.creatorEarnings(id).subscribe({
      next: (e) => this.earnings.set(e),
      // Денег может не быть вовсе: тариф проекту ещё не задали. Это не
      // сбой — блок просто не показывается.
      error: () => this.earnings.set(null),
    });
    this.api.creatorReport(id).subscribe({
      next: (r) => {
        this.report.set(r);
        this.reportCollapsed.set(r.collapsed);
      },
      error: (e) => {
        const err = parseApiError(e, '');
        // 410 — проект закрыт и подробные строки удалены. Это не сбой,
        // ругаться на него не за что.
        if (err.code === 'collapsed_no_detail') this.reportCollapsed.set(true);
      },
    });
  }
}
