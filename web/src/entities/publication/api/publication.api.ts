import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';

import { API_URL } from '@shared/api/api-url.token';
import {
  BatchPreview,
  BatchRequest,
  BatchResult,
  CalendarResponse,
  ChecklistItem,
  ChecklistSnapshot,
  ChecklistTemplate,
  ChecklistTemplateFull,
  ProjectSettings,
  SaveChecklistTemplateInput,
  ClientVideo,
  CreatorProject,
  CreatorProjectCard,
  DateRequest,
  LinkSuggestion,
  Material,
  MaterialInput,
  MonthRequest,
  NotificationPrefs,
  NotificationPrefsPatch,
  Platform,
  ProjectAccount,
  ProjectAccountInput,
  ProjectAccountsResponse,
  ProjectPerson,
  Publication,
  PublicationReport,
  RefreshStats,
  ReminderPrefs,
  ReminderPrefsPatch,
  ReviewDecision,
  ReviewMark,
} from '../model/publication.types';

interface ListResp<T> {
  items: T[];
}

// Ответ ручки чеклиста. template есть только в менеджерской выдаче и
// только когда чеклист подключали — отсюда опциональность.
interface ChecklistResp {
  items: ChecklistItem[];
  template?: ChecklistSnapshot;
}

@Injectable({ providedIn: 'root' })
export class PublicationApi {
  private readonly http = inject(HttpClient);

  private readonly api = inject(API_URL);

  // ---- креатор ----

  // Проекты, где я в действующем составе. Единственный вход на страницу
  // выкладок из кабинета: карточки проекта для креатора в API нет.
  public creatorProjects(): Observable<ListResp<CreatorProject>> {
    return this.http.get<ListResp<CreatorProject>>(`${this.api}/me/creator/projects`);
  }

  // Шапка страницы выкладок: название, бриф, период, месячный план,
  // нужен ли черновик, кому писать и счётчики по своим выкладкам.
  public creatorProjectCard(projectId: string): Observable<CreatorProjectCard> {
    return this.http.get<CreatorProjectCard>(`${this.api}/me/creator/projects/${projectId}`);
  }

  // Только свои выкладки: чужие бэк не отдаёт, фронт ничего не прячет.
  public creatorList(projectId: string): Observable<ListResp<Publication>> {
    return this.http.get<ListResp<Publication>>(
      `${this.api}/me/creator/projects/${projectId}/publications`,
    );
  }

  public creatorChecklist(projectId: string): Observable<ChecklistResp> {
    return this.http.get<ChecklistResp>(`${this.api}/me/creator/projects/${projectId}/checklist`);
  }

  /**
   * «Я исправил — проверьте ещё раз», не трогая ссылки.
   *
   * Нужна там, где правка идёт НА ПЛОЩАДКЕ и адрес ролика не меняется:
   * новой ссылки у креатора в этом случае нет, а сказать «готово» надо.
   * Ссылки и статистика остаются как есть — ролик тот же.
   *
   * 409 nothing_to_resubmit — ролик и так на проверке; это состояние, а
   * не поломка.
   */
  public creatorResubmit(pubId: string): Observable<Publication> {
    return this.http.post<Publication>(
      `${this.api}/me/creator/publications/${pubId}/resubmit`,
      {},
    );
  }

  public creatorReport(projectId: string): Observable<PublicationReport> {
    return this.http.get<PublicationReport>(`${this.api}/me/creator/projects/${projectId}/report`);
  }

  /** То же обновление в кабинете креатора: цифры он читает теми же глазами. */
  public creatorRefreshStats(projectId: string): Observable<RefreshStats> {
    return this.http.post<RefreshStats>(
      `${this.api}/me/creator/projects/${projectId}/report/refresh`,
      {},
    );
  }

  // Бэк отдаёт креатору только материалы своей аудитории — фильтровать
  // на фронте нечего.
  public creatorMaterials(projectId: string): Observable<ListResp<Material>> {
    return this.http.get<ListResp<Material>>(
      `${this.api}/me/creator/projects/${projectId}/materials`,
    );
  }


  // Сдать ролик ссылками. Можно сдать не все площадки — остальные дошлём
  // позже, пока выкладка не закрыта. checked_item_ids — отмеченные пункты
  // чеклиста: без обязательных бэк ответит 422 checklist_incomplete.
  public creatorSubmitLinks(
    pubId: string,
    urls: string[],
    checkedItemIds: string[],
    // Название ролика. Пустое сервер не записывает: досылая площадки,
    // поле можно не повторять, и записанное не затирается.
    title = '',
  ): Observable<Publication> {
    return this.http.post<Publication>(`${this.api}/me/creator/publications/${pubId}/links`, {
      urls,
      title,
      checked_item_ids: checkedItemIds,
    });
  }

  /**
   * Завести себе выкладку сверх плана, одной датой.
   *
   * Название ролика здесь не спрашивается: тему задаёт дата, а что снято
   * — известно только после съёмки. Название приходит вместе со
   * ссылками, обычным путём сдачи.
   *
   * Отказы приходят с готовым текстом в message, и показывать надо
   * именно его: 409 day_taken — на этот день выкладка уже есть, 409
   * period_locked — период подытожен, 400 invalid_input — дата в прошлом
   * или дальше чем на год вперёд, 404 not_found — чужой проект.
   *
   * dueDate — ГГГГ-ММ-ДД.
   */
  public creatorAddPublication(projectId: string, dueDate: string): Observable<Publication> {
    return this.http.post<Publication>(
      `${this.api}/me/creator/projects/${projectId}/publications`,
      { due_date: dueDate },
    );
  }

  // requestedDate — ГГГГ-ММ-ДД.
  public creatorRequestDate(
    pubId: string,
    requestedDate: string,
    reason: string,
  ): Observable<DateRequest> {
    return this.http.post<DateRequest>(
      `${this.api}/me/creator/publications/${pubId}/date_request`,
      { requested_date: requestedDate, reason },
    );
  }

  // ---- заказчик ----

  public clientVideos(projectId: string): Observable<ListResp<ClientVideo>> {
    return this.http.get<ListResp<ClientVideo>>(`${this.api}/me/projects/${projectId}/videos`);
  }

  public clientReport(projectId: string): Observable<PublicationReport> {
    return this.http.get<PublicationReport>(`${this.api}/me/projects/${projectId}/report`);
  }

  // Та же таблица, что у менеджера, и то же правило доступа: при
  // выключенном показе статистики бэк отвечает 404.
  public clientReportCsv(projectId: string): Observable<Blob> {
    return this.http.get(`${this.api}/me/projects/${projectId}/report.csv`, {
      responseType: 'blob',
    });
  }

  // Только помеченные audience=client. Обучение и бренд-гайд креаторов
  // сюда не попадают — ни здесь, ни в вёрстке их быть не должно.
  public clientMaterials(projectId: string): Observable<ListResp<Material>> {
    return this.http.get<ListResp<Material>>(`${this.api}/me/projects/${projectId}/materials`);
  }

  // Заявка на следующий месяц: кнопка под прикидкой цены. Открытая
  // заявка одна на проект — повторное нажатие уточняет её, а не заводит
  // вторую, иначе у менеджера копится стопка одинаковых плашек.
  public clientMonthRequest(projectId: string): Observable<{ request: MonthRequest | null }> {
    return this.http.get<{ request: MonthRequest | null }>(
      `${this.api}/me/projects/${projectId}/month-request`,
    );
  }

  public clientAskMonth(
    projectId: string,
    body: { creators: number; videos: number; ceiling: number; month?: string },
  ): Observable<{ request: MonthRequest }> {
    return this.http.post<{ request: MonthRequest }>(
      `${this.api}/me/projects/${projectId}/month-request`,
      body,
    );
  }

  public managerMonthRequest(projectId: string): Observable<{ request: MonthRequest | null }> {
    return this.http.get<{ request: MonthRequest | null }>(
      `${this.api}/manager/projects/${projectId}/month-request`,
    );
  }

  public managerHandleMonthRequest(projectId: string): Observable<void> {
    return this.http.post<void>(
      `${this.api}/manager/projects/${projectId}/month-request/handled`,
      {},
    );
  }

  // month — ГГГГ-ММ; без него бэк берёт текущий.
  public clientCalendar(projectId: string, month?: string): Observable<CalendarResponse> {
    const params = month ? new HttpParams().set('month', month) : undefined;
    return this.http.get<CalendarResponse>(`${this.api}/me/projects/${projectId}/calendar`, {
      params,
    });
  }

  public clientPrefs(projectId: string): Observable<NotificationPrefs> {
    return this.http.get<NotificationPrefs>(`${this.api}/me/projects/${projectId}/notifications`);
  }

  // Частичное обновление одним запросом: незаданные поля бэк не трогает,
  // так две вкладки клиента не затирают правки друг друга.
  public clientSavePrefs(
    projectId: string,
    patch: NotificationPrefsPatch,
  ): Observable<NotificationPrefs> {
    return this.http.put<NotificationPrefs>(
      `${this.api}/me/projects/${projectId}/notifications`,
      patch,
    );
  }

  // ---- менеджер ----

  public managerList(projectId: string): Observable<ListResp<Publication>> {
    return this.http.get<ListResp<Publication>>(
      `${this.api}/manager/projects/${projectId}/publications`,
    );
  }

  public managerReport(projectId: string): Observable<PublicationReport> {
    return this.http.get<PublicationReport>(`${this.api}/manager/projects/${projectId}/report`);
  }

  /**
   * Обновить просмотры по проекту прямо сейчас.
   *
   * Зовётся при открытии карточки: человек смотрит на цифры, и у
   * свежего ролика они обязаны быть сегодняшними. Сервер сам решает,
   * кого обходить, — по затухающему расписанию первых суток ролика
   * (минута, пять, десять, полчаса, час, шесть часов), поэтому
   * перезагрузка страницы кредитов у поставщика не стоит.
   *
   * `refreshed` — сколько ссылок обошли, `saved` — по скольким пришли
   * цифры. Ноль в первом означает «и так свежие», а не отказ. 503
   * collector_not_set — сбор не настроен; это состояние стенда, и
   * показывать его как поломку не нужно.
   */
  public managerRefreshStats(projectId: string): Observable<RefreshStats> {
    return this.http.post<RefreshStats>(
      `${this.api}/manager/projects/${projectId}/report/refresh`,
      {},
    );
  }

  // Выгрузка тянется запросом, а не ссылкой в <a href>: ручка закрыта
  // Bearer-токеном, а его в адресную строку не положить — прежняя ссылка
  // молча открывала вкладку с 401.
  public managerReportCsv(projectId: string): Observable<Blob> {
    return this.http.get(`${this.api}/manager/projects/${projectId}/report.csv`, {
      responseType: 'blob',
    });
  }

  // Предпросмотр дат до создания: массовая простановка — единственное
  // место, где одна ошибка стоит ручной чистки десятков строк.
  public managerPreviewBatch(projectId: string, req: BatchRequest): Observable<BatchPreview> {
    return this.http.post<BatchPreview>(
      `${this.api}/manager/projects/${projectId}/publications/preview`,
      req,
    );
  }

  public managerCreateBatch(projectId: string, req: BatchRequest): Observable<BatchResult> {
    return this.http.post<BatchResult>(
      `${this.api}/manager/projects/${projectId}/publications/batch`,
      req,
    );
  }

  /**
   * Поставить одну выкладку на дату.
   *
   * Пачкой ставят план на месяц, а дальше он живёт: креатор заболел,
   * вместо выбывшего взяли нового, один день сняли совсем. Отказы
   * приходят с готовым текстом: 409 day_taken — на этот день у креатора
   * уже есть выкладка, 409 period_locked — период подытожен, 409
   * creator_not_in_project — его нет в составе.
   *
   * dueDate — ГГГГ-ММ-ДД.
   */
  public managerAddPublication(
    projectId: string,
    creatorUserId: string,
    dueDate: string,
    draftLeadDays = 0,
  ): Observable<Publication> {
    return this.http.post<Publication>(`${this.api}/manager/projects/${projectId}/publications`, {
      creator_user_id: creatorUserId,
      due_date: dueDate,
      draft_lead_days: draftLeadDays,
    });
  }

  /**
   * Перенести дату выкладки.
   *
   * Только по плановой и только пока по ней ничего не сдано: 409
   * publication_started. Открытая просьба креатора о переносе
   * закрывается этим же действием — сервер сам отвечает на неё
   * «одобрено» или «отклонено», смотря куда поставили дату.
   */
  public managerMoveDueDate(pubId: string, dueDate: string): Observable<Publication> {
    return this.http.put<Publication>(`${this.api}/manager/publications/${pubId}/due_date`, {
      due_date: dueDate,
    });
  }

  /**
   * Снять запланированную выкладку.
   *
   * Не то же, что «закрыть неполную»: там ролик вышел не везде, здесь
   * выкладки не будет вовсе. Сданное не снимается (409
   * publication_started).
   */
  public managerCancelPublication(pubId: string, reason: string): Observable<Publication> {
    return this.http.post<Publication>(`${this.api}/manager/publications/${pubId}/cancel`, {
      reason,
    });
  }

  public managerCancelBatch(projectId: string, batchId: string): Observable<{ cancelled: number }> {
    return this.http.post<{ cancelled: number }>(
      `${this.api}/manager/projects/${projectId}/publications/cancel_batch`,
      { batch_id: batchId },
    );
  }

  public managerClose(pubId: string, reason: string): Observable<Publication> {
    return this.http.post<Publication>(`${this.api}/manager/publications/${pubId}/close`, {
      reason,
    });
  }

  public managerRemind(pubId: string): Observable<{ sent: boolean }> {
    return this.http.post<{ sent: boolean }>(
      `${this.api}/manager/publications/${pubId}/remind`,
      {},
    );
  }

  public managerDecideDateRequest(reqId: string, approve: boolean): Observable<void> {
    return this.http.post<void>(`${this.api}/manager/publication_date_requests/${reqId}/decide`, {
      approve,
    });
  }

  // Действующий состав с именами и ссылками на аккаунты. Выбывшие не
  // приходят — «убрать из проекта» мягкое, но из ростера исчезает сразу.
  public managerCreators(projectId: string): Observable<ListResp<ProjectPerson>> {
    return this.http.get<ListResp<ProjectPerson>>(
      `${this.api}/manager/projects/${projectId}/creators`,
    );
  }

  public managerAddCreator(projectId: string, creatorUserId: string): Observable<void> {
    return this.http.post<void>(`${this.api}/manager/projects/${projectId}/creators`, {
      creator_user_id: creatorUserId,
    });
  }

  public managerRemoveCreator(projectId: string, creatorId: string): Observable<void> {
    return this.http.delete<void>(
      `${this.api}/manager/projects/${projectId}/creators/${creatorId}`,
    );
  }

  /**
   * Колокольчик «напомнить накануне» — у каждого креатора свой.
   * Сильнее настройки проекта: напоминание включают тому, кто забывает.
   */
  public managerSetCreatorReminder(
    projectId: string,
    creatorId: string,
    dayBefore: boolean,
  ): Observable<{ day_before: boolean }> {
    return this.http.put<{ day_before: boolean }>(
      `${this.api}/manager/projects/${projectId}/creators/${creatorId}/reminders`,
      { day_before: dayBefore },
    );
  }

  // ---- «это ваш ролик?» ----
  //
  // Находки приходят по всем проектам сразу: карточка рождается от
  // площадки, а не от проекта, и гонять человека по шести вкладкам за
  // ней — значит не показать её вовсе.

  public creatorSuggestions(): Observable<ListResp<LinkSuggestion>> {
    return this.http.get<ListResp<LinkSuggestion>>(`${this.api}/me/creator/suggestions`);
  }

  public creatorLinkSuggestion(id: string, publicationId?: string): Observable<Publication> {
    return this.http.post<Publication>(`${this.api}/me/creator/suggestions/${id}/link`, {
      publication_id: publicationId ?? '',
    });
  }

  public creatorDismissSuggestion(id: string): Observable<void> {
    return this.http.delete<void>(`${this.api}/me/creator/suggestions/${id}`);
  }

  // Снимок, подключённый к проекту. Правки в нём остаются внутри проекта:
  // библиотека шаблонов живёт отдельно.
  public managerChecklist(projectId: string): Observable<ChecklistResp> {
    return this.http.get<ChecklistResp>(`${this.api}/manager/projects/${projectId}/checklist`);
  }

  // Переключатели проекта. Выключение этапа черновика не стирает уже
  // проставленные сроки — по ним креатор уже сдаёт.
  public managerProjectSettings(projectId: string): Observable<ProjectSettings> {
    return this.http.get<ProjectSettings>(`${this.api}/manager/projects/${projectId}/settings`);
  }

  public managerSaveProjectSettings(
    projectId: string,
    input: ProjectSettings,
  ): Observable<ProjectSettings> {
    return this.http.put<ProjectSettings>(
      `${this.api}/manager/projects/${projectId}/settings`,
      input,
    );
  }

  // ---- библиотека чеклистов под админом ----

  public adminChecklistTemplates(): Observable<ListResp<ChecklistTemplate>> {
    return this.http.get<ListResp<ChecklistTemplate>>(`${this.api}/admin/checklist_templates`);
  }

  public adminChecklistTemplate(id: string): Observable<ChecklistTemplateFull> {
    return this.http.get<ChecklistTemplateFull>(`${this.api}/admin/checklist_templates/${id}`);
  }

  // Выпуск версии, а не правка: прежняя гасится на сервере.
  public adminSaveChecklistTemplate(
    input: SaveChecklistTemplateInput,
  ): Observable<ChecklistTemplateFull> {
    return this.http.post<ChecklistTemplateFull>(`${this.api}/admin/checklist_templates`, input);
  }

  public adminDeleteChecklistTemplate(id: string): Observable<void> {
    return this.http.delete<void>(`${this.api}/admin/checklist_templates/${id}`);
  }

  // Библиотека: из чего выбирать при подключении. Выключенные шаблоны бэк
  // не отдаёт — подключить их всё равно нельзя.
  public managerChecklistTemplates(): Observable<ListResp<ChecklistTemplate>> {
    return this.http.get<ListResp<ChecklistTemplate>>(`${this.api}/manager/checklist_templates`);
  }

  // Снимок чеклиста из библиотеки: последующая правка шаблона этот проект
  // уже не меняет. Этой же ручкой делается «обновить до новой версии» —
  // отдельной ручки обновления в API нет, есть повторный снимок с
  // template_id нужной версии.
  public managerSnapshotChecklist(
    projectId: string,
    templateId: string,
  ): Observable<{ copied: number }> {
    return this.http.post<{ copied: number }>(
      `${this.api}/manager/projects/${projectId}/checklist`,
      { template_id: templateId },
    );
  }

  /**
   * Исправить сданную ссылку.
   *
   * Ссылку сдаёт креатор, и ошибается в ней он же: чужой ролик, адрес
   * профиля вместо видео, мобильный домен с обрезанным id. Пустой url
   * снимает ссылку с площадки — выкладка снова становится неполной.
   *
   * Если ролик другой, сервер удаляет его прежние замеры: две разные
   * записи в одной линии графика — это не история, это выдумка.
   */
  /**
   * Креатор пересылает свою ссылку: ролик удалили с площадки, адрес
   * протух. Снять площадку он не может — пустой адрес сервер отклонит.
   */
  public creatorEditLink(pubId: string, platform: Platform, url: string): Observable<Publication> {
    return this.http.put<Publication>(
      `${this.api}/me/creator/publications/${pubId}/links/${platform}`,
      { url },
    );
  }

  public managerEditLink(pubId: string, platform: Platform, url: string): Observable<Publication> {
    return this.http.put<Publication>(
      `${this.api}/manager/publications/${pubId}/links/${platform}`,
      { url },
    );
  }

  /**
   * Проверка ролика: вердикты по пунктам и решение.
   *
   * Вердикты уходят ЦЕЛИКОМ: снятая отметка — это отсутствие строки, а
   * не отдельная команда «удалить». Пустое decision сохраняет ход
   * проверки; принять сервер не даст, пока обязательные пункты сданных
   * площадок не отмечены «да» (422 review_blocked) — кнопку на фронте
   * можно погасить, а можно и забыть.
   */
  public managerReview(
    pubId: string,
    marks: ReviewMark[],
    comment: string,
    decision: ReviewDecision,
  ): Observable<Publication> {
    return this.http.post<Publication>(`${this.api}/manager/publications/${pubId}/review`, {
      marks,
      comment,
      decision,
    });
  }

  // ---- доступы к аккаунтам бренда ----
  //
  // Заполняет менеджер, читает заказчик. Пароль отдаётся отдельной
  // ручкой: в списке проекта ему делать нечего.

  public managerAccounts(projectId: string): Observable<ProjectAccountsResponse> {
    return this.http.get<ProjectAccountsResponse>(
      `${this.api}/manager/projects/${projectId}/accounts`,
    );
  }

  public managerAddAccount(
    projectId: string,
    input: ProjectAccountInput,
  ): Observable<ProjectAccount> {
    return this.http.post<ProjectAccount>(
      `${this.api}/manager/projects/${projectId}/accounts`,
      input,
    );
  }

  /**
   * Дополнить чек-лист проекта своим пунктом.
   *
   * Пункт живёт ТОЛЬКО в этом проекте и в библиотеку не попадает:
   * «шрифт титров — Onest Bold» касается одного бренда. Правило снимка
   * от этого не страдает — оно про то, что правка библиотеки не
   * доезжает до идущих проектов, а не про запрет уточнять.
   */
  public managerAddChecklistItem(
    projectId: string,
    input: { text: string; platform?: string; is_required: boolean },
  ): Observable<ChecklistItem> {
    return this.http.post<ChecklistItem>(
      `${this.api}/manager/projects/${projectId}/checklist/items`,
      input,
    );
  }

  public managerUpdateAccount(
    projectId: string,
    accountId: string,
    input: ProjectAccountInput,
  ): Observable<ProjectAccount> {
    return this.http.put<ProjectAccount>(
      `${this.api}/manager/projects/${projectId}/accounts/${accountId}`,
      input,
    );
  }

  public managerRemoveAccount(projectId: string, accountId: string): Observable<void> {
    return this.http.delete<void>(
      `${this.api}/manager/projects/${projectId}/accounts/${accountId}`,
    );
  }

  public managerAccountSecret(
    projectId: string,
    accountId: string,
  ): Observable<{ password: string }> {
    return this.http.get<{ password: string }>(
      `${this.api}/manager/projects/${projectId}/accounts/${accountId}/secret`,
    );
  }

  // ---- «мои аккаунты» у креатора ----
  //
  // Аккаунты ЭТОГО проекта, а не личная страница из профиля: под проект
  // креатор заводит отдельные и ведёт их сам.

  public creatorAccounts(projectId: string): Observable<ProjectAccountsResponse> {
    return this.http.get<ProjectAccountsResponse>(
      `${this.api}/me/creator/projects/${projectId}/accounts`,
    );
  }

  public creatorAddAccount(
    projectId: string,
    body: ProjectAccountInput,
  ): Observable<ProjectAccount> {
    return this.http.post<ProjectAccount>(
      `${this.api}/me/creator/projects/${projectId}/accounts`,
      body,
    );
  }

  public creatorUpdateAccount(
    projectId: string,
    accountId: string,
    body: ProjectAccountInput,
  ): Observable<ProjectAccount> {
    return this.http.put<ProjectAccount>(
      `${this.api}/me/creator/projects/${projectId}/accounts/${accountId}`,
      body,
    );
  }

  public creatorRemoveAccount(projectId: string, accountId: string): Observable<void> {
    return this.http.delete<void>(
      `${this.api}/me/creator/projects/${projectId}/accounts/${accountId}`,
    );
  }

  public creatorAccountSecret(
    projectId: string,
    accountId: string,
  ): Observable<{ password: string }> {
    return this.http.get<{ password: string }>(
      `${this.api}/me/creator/projects/${projectId}/accounts/${accountId}/secret`,
    );
  }

  public clientAccounts(projectId: string): Observable<ProjectAccountsResponse> {
    return this.http.get<ProjectAccountsResponse>(`${this.api}/me/projects/${projectId}/accounts`);
  }

  public clientAccountSecret(
    projectId: string,
    accountId: string,
  ): Observable<{ password: string }> {
    return this.http.get<{ password: string }>(
      `${this.api}/me/projects/${projectId}/accounts/${accountId}/secret`,
    );
  }

  /**
   * Убрать пункт из чек-листа проекта.
   *
   * Сервер откажет (409 item_used), если по пункту уже отчитывались:
   * вместе с ним исчез бы след того, что креатор это проверял.
   */
  public managerDeleteChecklistItem(projectId: string, itemId: string): Observable<void> {
    return this.http.delete<void>(
      `${this.api}/manager/projects/${projectId}/checklist/items/${itemId}`,
    );
  }

  public managerMaterials(projectId: string): Observable<ListResp<Material>> {
    return this.http.get<ListResp<Material>>(`${this.api}/manager/projects/${projectId}/materials`);
  }

  public managerAddMaterial(projectId: string, input: MaterialInput): Observable<Material> {
    return this.http.post<Material>(`${this.api}/manager/projects/${projectId}/materials`, input);
  }

  public managerRemoveMaterial(projectId: string, materialId: string): Observable<void> {
    return this.http.delete<void>(
      `${this.api}/manager/projects/${projectId}/materials/${materialId}`,
    );
  }

  public managerAutoping(projectId: string): Observable<ReminderPrefs> {
    return this.http.get<ReminderPrefs>(`${this.api}/manager/projects/${projectId}/autoping`);
  }

  // Частичное тело: не переданное поле остаётся как было. Так два
  // открытых экрана менеджера не затирают тумблеры друг друга.
  public managerSaveAutoping(
    projectId: string,
    patch: ReminderPrefsPatch,
  ): Observable<ReminderPrefs> {
    return this.http.put<ReminderPrefs>(
      `${this.api}/manager/projects/${projectId}/autoping`,
      patch,
    );
  }
}
