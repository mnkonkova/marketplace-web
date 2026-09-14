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
  Material,
  MaterialInput,
  NotificationPrefs,
  NotificationPrefsPatch,
  ProjectPerson,
  Publication,
  PublicationReport,
  ReminderPrefs,
  ReminderPrefsPatch,
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

  public creatorReport(projectId: string): Observable<PublicationReport> {
    return this.http.get<PublicationReport>(`${this.api}/me/creator/projects/${projectId}/report`);
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
