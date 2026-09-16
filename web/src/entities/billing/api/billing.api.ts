import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';

import { API_URL } from '@shared/api/api-url.token';
import {
  Accrual,
  ClientOverview,
  BillingTerms,
  BillingTermsInput,
  CreatorEarnings,
  OverviewRange,
  Payment,
  PaymentInput,
  PaymentKind,
  ProjectBilling,
  ProjectPeriod,
  PublishTermsInput,
  TermsVersion,
  CreatorSubscribers,
  UtmLink,
} from '../model/billing.types';

interface ListResp<T> {
  items: T[];
}

// Номер периода в query. Пусто — текущий: это разные запросы, и слать
// `period=` пустой строкой значит спросить период с номером «ничего».
function periodParam(period?: number): HttpParams | undefined {
  return period === undefined ? undefined : new HttpParams().set('period', period);
}

@Injectable({ providedIn: 'root' })
export class BillingApi {
  private readonly http = inject(HttpClient);

  private readonly api = inject(API_URL);

  // ---- прайс площадки (админ) ----

  public adminListTerms(): Observable<ListResp<TermsVersion>> {
    return this.http.get<ListResp<TermsVersion>>(`${this.api}/admin/terms`);
  }

  // Выпуск новой версии, а не правка старой: под старой стоит согласие
  // клиентов, и переписывать её задним числом нельзя.
  public adminPublishTerms(input: PublishTermsInput): Observable<TermsVersion> {
    return this.http.post<TermsVersion>(`${this.api}/admin/terms`, input);
  }

  // ---- менеджер ----

  // Условия, платежи заказчика, начисления за период, UTM и итог —
  // одним ответом: по частям это пять запросов на один экран.
  //
  // period — НОМЕР периода, а не месяц: периоды катятся от даты первой
  // публикации. Пусто — текущий. У проекта, где ещё ничего не вышло,
  // ручка отвечает 404 no_periods: считать не от чего.
  public managerBilling(projectId: string, period?: number): Observable<ProjectBilling> {
    return this.http.get<ProjectBilling>(`${this.api}/manager/projects/${projectId}/billing`, {
      params: periodParam(period),
    });
  }

  // Периоды проекта списком. Раньше выпадашка рисовала последние
  // двенадцать календарных месяцев — список месяцев, про которые никто
  // не знал, есть ли там что-нибудь. Здесь ровно те периоды, которые
  // существуют.
  public managerPeriods(projectId: string): Observable<ListResp<ProjectPeriod>> {
    return this.http.get<ListResp<ProjectPeriod>>(
      `${this.api}/manager/projects/${projectId}/billing/periods`,
    );
  }

  // Взять числа из действующего прайса. Дальше они живут снимком: правка
  // прайса этот проект уже не меняет.
  public managerAdoptTerms(projectId: string): Observable<BillingTerms> {
    return this.http.post<BillingTerms>(
      `${this.api}/manager/projects/${projectId}/billing/adopt`,
      {},
    );
  }

  // Сколько ждём от заказчика. Подтверждённый платёж не переписывается:
  // бэк ответит 409 already_confirmed.
  public managerSavePayment(
    projectId: string,
    kind: PaymentKind,
    input: PaymentInput,
  ): Observable<Payment> {
    return this.http.put<Payment>(
      `${this.api}/manager/projects/${projectId}/payments/${kind}`,
      input,
    );
  }

  public managerConfirmPayment(projectId: string, kind: PaymentKind): Observable<Payment> {
    return this.http.post<Payment>(
      `${this.api}/manager/projects/${projectId}/payments/${kind}/confirm`,
      {},
    );
  }

  // Пересчёт по фактам периода. Утверждённые и выплаченные строки не
  // трогаются — это и есть «период закрыт».
  public managerRecalcAccruals(projectId: string, period?: number): Observable<ListResp<Accrual>> {
    return this.http.post<ListResp<Accrual>>(
      `${this.api}/manager/projects/${projectId}/accruals/recalc`,
      {},
      { params: periodParam(period) },
    );
  }

  // Две кнопки строго по очереди: выплатить неутверждённое нельзя, бэк
  // ответит 409 wrong_accrual_status.
  public managerApproveAccrual(projectId: string, accrualId: string): Observable<Accrual> {
    return this.http.post<Accrual>(
      `${this.api}/manager/projects/${projectId}/accruals/${accrualId}/approve`,
      {},
    );
  }

  public managerMarkAccrualPaid(projectId: string, accrualId: string): Observable<Accrual> {
    return this.http.post<Accrual>(
      `${this.api}/manager/projects/${projectId}/accruals/${accrualId}/paid`,
      {},
    );
  }

  public managerSaveUtm(projectId: string, creatorId: string, url: string): Observable<UtmLink> {
    return this.http.put<UtmLink>(
      `${this.api}/manager/projects/${projectId}/creators/${creatorId}/utm`,
      { url },
    );
  }

  /**
   * Вписать подписчиков за период.
   *
   * Сборщика подписчиков в продукте нет, и выдумывать его нельзя: ставку
   * объявляет прайс, а число за период вводит менеджер — ровно так же,
   * как заведены переходы по UTM. Деньги от этого числа считает сервер.
   */
  public managerSaveSubscribers(
    projectId: string,
    creatorId: string,
    subscribers: number,
    period: number,
  ): Observable<CreatorSubscribers> {
    return this.http.put<CreatorSubscribers>(
      `${this.api}/manager/projects/${projectId}/creators/${creatorId}/subscribers`,
      { subscribers, period },
    );
  }

  // ---- админ ----

  // Переоткрыть подытоженный период. Подытоживает только автоматика, и
  // отменить её решение может один админ: это правка уже выставленного
  // счёта, а не рядовое действие менеджера.
  public adminUnlockPeriod(projectId: string, period: number): Observable<ProjectPeriod> {
    return this.http.post<ProjectPeriod>(
      `${this.api}/admin/projects/${projectId}/billing/unlock_period`,
      {},
      { params: new HttpParams().set('period', period) },
    );
  }

  // ---- заказчик ----

  // Что подписано, что оплачено и во сколько обошлась команда месяца.
  // Начисления заказчик видит: он за них платит, и «60 000 + 5 850» —
  // его счёт. UTM-меток здесь нет — это инструмент менеджера.
  public clientBilling(projectId: string, period?: number): Observable<ProjectBilling> {
    return this.http.get<ProjectBilling>(`${this.api}/me/projects/${projectId}/billing`, {
      params: periodParam(period),
    });
  }

  /**
   * Сводка по всем проектам заказчика.
   *
   * Кросс-проектный срез: просмотры по площадкам, счёт, стоимость тысячи
   * просмотров и график роста. В проекте по отдельности такого ответа
   * нет — там всё считается внутри одного проекта.
   */
  public clientOverview(range?: OverviewRange): Observable<ClientOverview> {
    // Окно уходит в query, только если его выбрали: пустой `range=`
    // сервер обязан был бы трактовать как окно с именем «ничего».
    return this.http.get<ClientOverview>(`${this.api}/me/overview`, {
      params: range ? new HttpParams().set('range', range) : undefined,
    });
  }

  // ---- креатор ----

  // По каким условиям и сколько вышло по месяцам. Чужих цифр здесь нет.
  public creatorEarnings(projectId: string): Observable<CreatorEarnings> {
    return this.http.get<CreatorEarnings>(`${this.api}/me/creator/projects/${projectId}/earnings`);
  }
}
