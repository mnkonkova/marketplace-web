import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';

import { API_URL } from '@shared/api/api-url.token';
import {
  Accrual,
  BillingTerms,
  BillingTermsInput,
  CreatorEarnings,
  Payment,
  PaymentInput,
  PaymentKind,
  ProjectBilling,
  PublishTermsInput,
  TermsVersion,
  UtmLink,
} from '../model/billing.types';

interface ListResp<T> {
  items: T[];
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

  // Условия, платежи заказчика, начисления за месяц, UTM и итог периода —
  // одним ответом: по частям это пять запросов на один экран.
  public managerBilling(projectId: string, month?: string): Observable<ProjectBilling> {
    const params = month ? new HttpParams().set('month', month) : undefined;
    return this.http.get<ProjectBilling>(`${this.api}/manager/projects/${projectId}/billing`, {
      params,
    });
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

  // Пересчёт по фактам месяца. Утверждённые и выплаченные строки не
  // трогаются — это и есть «период закрыт».
  public managerRecalcAccruals(projectId: string, month?: string): Observable<ListResp<Accrual>> {
    const params = month ? new HttpParams().set('month', month) : undefined;
    return this.http.post<ListResp<Accrual>>(
      `${this.api}/manager/projects/${projectId}/accruals/recalc`,
      {},
      { params },
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

  // ---- заказчик ----

  // Что подписано, что оплачено и во сколько обошлась команда месяца.
  // Начисления заказчик видит: он за них платит, и «60 000 + 5 850» —
  // его счёт. UTM-меток здесь нет — это инструмент менеджера.
  public clientBilling(projectId: string, month?: string): Observable<ProjectBilling> {
    const params = month ? new HttpParams().set('month', month) : undefined;
    return this.http.get<ProjectBilling>(`${this.api}/me/projects/${projectId}/billing`, {
      params,
    });
  }

  // ---- креатор ----

  // По каким условиям и сколько вышло по месяцам. Чужих цифр здесь нет.
  public creatorEarnings(projectId: string): Observable<CreatorEarnings> {
    return this.http.get<CreatorEarnings>(`${this.api}/me/creator/projects/${projectId}/earnings`);
  }
}
