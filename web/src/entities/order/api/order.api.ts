import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';

import { API_URL } from '@shared/api/api-url.token';
import {
  Availability,
  Invitation,
  Order,
  OrderBrief,
  OrderEstimate,
  OrderLimit,
  OrderTerms,
} from '../model/order.types';

interface ListResp<T> {
  items: T[];
}

@Injectable({ providedIn: 'root' })
export class OrderApi {
  private readonly http = inject(HttpClient);

  private readonly api = inject(API_URL);

  // ---- заказчик ----

  public listOrders(): Observable<ListResp<Order>> {
    return this.http.get<ListResp<Order>>(`${this.api}/me/orders`);
  }

  public getOrder(id: string): Observable<Order> {
    return this.http.get<Order>(`${this.api}/me/orders/${id}`);
  }

  // Заявка «под ключ»: бриф, отмеченные креаторы и объём роликов.
  //
  // creator_ids — кого отметили, без порядка: очередь приглашений ушла,
  // приглашение уходит всем известным креаторам, а отмеченные получают
  // его с пометкой «вас хотят особенно».
  //
  // Ответ несёт project_id: проект заводится ВМЕСТЕ с заявкой, и
  // заказчику сразу есть куда прийти и где написать.
  public createOrder(payload: {
    start_month: string;
    needed: number;
    videos_count: number;
    creator_ids: string[];
    brief?: OrderBrief;
  }): Observable<{ order: Order; busy_creators?: string[] }> {
    return this.http.post<{ order: Order; busy_creators?: string[] }>(
      `${this.api}/me/orders`,
      payload,
    );
  }

  // Бриф правят и после отправки: половина заказчиков вспоминает про
  // референсы уже потом. Текст переписывается целиком.
  public saveBrief(orderId: string, brief: OrderBrief): Observable<{ brief: OrderBrief }> {
    return this.http.patch<{ brief: OrderBrief }>(`${this.api}/me/orders/${orderId}/brief`, brief);
  }

  public invite(orderId: string): Observable<Order> {
    return this.http.post<Order>(`${this.api}/me/orders/${orderId}/invite`, {});
  }

  // Переставить приоритет. Присылать надо РОВНО тех, кого ещё не звали,
  // в новом порядке: перестановка меняет порядок, а не состав — иначе бэк
  // ответит 400 priority_set_mismatch. У приглашённого уже тикает срок
  // ответа, поэтому его место не двигается. Собранный заказ не
  // переставляется вовсе: 409 priority_locked.
  public reorderPriority(orderId: string, creatorIds: string[]): Observable<Order> {
    return this.http.put<Order>(`${this.api}/me/orders/${orderId}/priority`, {
      creator_ids: creatorIds,
    });
  }

  public cancelOrder(orderId: string): Observable<Order> {
    return this.http.post<Order>(`${this.api}/me/orders/${orderId}/cancel`, {});
  }

  public terms(): Observable<{ terms: OrderTerms; consented: boolean }> {
    return this.http.get<{ terms: OrderTerms; consented: boolean }>(`${this.api}/me/orders/terms`);
  }

  public consent(): Observable<OrderTerms> {
    return this.http.post<OrderTerms>(`${this.api}/me/orders/terms/consent`, {});
  }

  // Лимит считается НА МЕСЯЦ СТАРТА, а не на сегодня: к декабрю у клиента
  // может быть закрыто больше месяцев, чем к сентябрю, и лимит на сегодня
  // показывал бы не то число, по которому потом создастся заказ.
  public limit(month?: string): Observable<OrderLimit> {
    const params = month ? new HttpParams().set('month', month) : undefined;
    return this.http.get<OrderLimit>(`${this.api}/me/orders/limit`, { params });
  }

  // Смета до создания заказа: клиент собирает состав, и сумма
  // пересчитывается на каждое изменение. Порядок creatorIds здесь не
  // важен — на сумму влияет состав, а не приоритет.
  public draftEstimate(payload: {
    needed: number;
    videos_count: number;
    creator_ids: string[];
  }): Observable<OrderEstimate> {
    return this.http.post<OrderEstimate>(`${this.api}/me/orders/estimate`, payload);
  }

  // Смета по созданному заказу. Считается по версии правил, записанной в
  // заказ: числа сойдутся с черновичными, если прайс за эти минуты не
  // поменяли.
  public orderEstimate(orderId: string): Observable<OrderEstimate> {
    return this.http.get<OrderEstimate>(`${this.api}/me/orders/${orderId}/estimate`);
  }

  // Занятость нужна на карточке в выдаче: иначе первым в списке окажется
  // тот, кто взять не может. month — ГГГГ-ММ, не больше 200 id за раз.
  public busyCreators(
    month: string,
    creatorIds: string[],
  ): Observable<{
    month: string;
    busy: string[];
  }> {
    return this.http.post<{ month: string; busy: string[] }>(`${this.api}/me/orders/availability`, {
      month,
      creator_ids: creatorIds,
    });
  }

  // ---- креатор ----

  public invitations(): Observable<ListResp<Invitation>> {
    return this.http.get<ListResp<Invitation>>(`${this.api}/me/creator/invitations`);
  }

  public respondInvitation(orderId: string, accept: boolean): Observable<Order> {
    return this.http.post<Order>(`${this.api}/me/creator/invitations/${orderId}/respond`, {
      accept,
    });
  }

  // Своя занятость на months месяцев вперёд (1–24, по умолчанию 12).
  // В ответе только отмеченные месяцы: пропуск — это «не отмечал», а не
  // «свободен», и подставлять за креатора значение нельзя.
  public myAvailability(months = 12): Observable<ListResp<Availability>> {
    return this.http.get<ListResp<Availability>>(`${this.api}/me/creator/availability`, {
      params: new HttpParams().set('months', months),
    });
  }

  // month — ГГГГ-ММ.
  public setAvailability(month: string, available: boolean): Observable<void> {
    return this.http.put<void>(`${this.api}/me/creator/availability`, { month, available });
  }

  // ---- менеджер ----

  public managerNeedingAttention(): Observable<ListResp<Order>> {
    return this.http.get<ListResp<Order>>(`${this.api}/manager/orders`);
  }

  // Заказ, из которого вырос проект. 404 — проект заведён руками, заказа
  // не было вовсе: это нормальное состояние, а не сбой.
  //
  // Отдельная ручка, а не фильтр managerNeedingAttention: тот список
  // отдаёт только застрявшие заказы, а у проекта заказ давно оплачен и
  // туда не попадает.
  public managerProjectOrder(projectId: string): Observable<Order> {
    return this.http.get<Order>(`${this.api}/manager/projects/${projectId}/order`);
  }

  // Двинуть очередь руками. Обычно она двигается сама — отказ и сгоревшее
  // приглашение сразу отдают место следующему, — но заказ мог остаться
  // черновиком, и тогда приглашения не уходили вовсе. Зовёт только на
  // реально свободное место: иначе 409 no_free_slot.
  public managerInvite(orderId: string): Observable<Order> {
    return this.http.post<Order>(`${this.api}/manager/orders/${orderId}/invite`, {});
  }

  public managerAddCandidates(orderId: string, creatorIds: string[]): Observable<Order> {
    return this.http.post<Order>(`${this.api}/manager/orders/${orderId}/candidates`, {
      creator_ids: creatorIds,
    });
  }

  public managerMarkPaid(orderId: string): Observable<Order> {
    return this.http.post<Order>(`${this.api}/manager/orders/${orderId}/paid`, {});
  }
}
