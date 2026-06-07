import { CommonModule } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzFormModule } from 'ng-zorro-antd/form';
import { NzInputModule } from 'ng-zorro-antd/input';
import { NzMessageService } from 'ng-zorro-antd/message';
import { NzModalModule } from 'ng-zorro-antd/modal';
import { NzSelectModule } from 'ng-zorro-antd/select';

import { AuthSessionStore } from '@entities/auth/model/auth-session.store';
import { ClientProfileApi } from '@entities/me/api/client-profile.api';
import {
  SupportApi,
  SupportMessagePayload,
  SupportTopic,
} from '@entities/support/api/support.api';

// SupportFooterComponent — глобальный футер с ссылкой «Написать в поддержку»,
// открывающей модалку формы. Включается один раз в AppComponent.
@Component({
  selector: 'app-support-footer',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    NzButtonModule,
    NzModalModule,
    NzInputModule,
    NzSelectModule,
    NzFormModule,
  ],
  templateUrl: './support-footer.component.html',
  styleUrl: './support-footer.component.scss',
})
export class SupportFooterComponent {
  private readonly api = inject(SupportApi);
  private readonly msg = inject(NzMessageService);
  private readonly auth = inject(AuthSessionStore);
  private readonly profileApi = inject(ClientProfileApi);

  public readonly open = signal(false);
  public readonly busy = signal(false);
  public readonly prefilled = signal(false);

  // Plain поля — connected to [(ngModel)]. Раньше canSend был computed
  // от плоских полей и тогда сигнальный tracking не работал → кнопка
  // вечно disabled. Перевели canSend в обычный метод — Angular CD сам
  // пересчитывает при изменениях.
  public email = '';
  public name = '';
  public topic: SupportTopic = 'other';
  public message = '';

  public canSend(): boolean {
    return this.email.trim().length > 3
      && this.message.trim().length >= 10
      && !this.busy();
  }

  public openModal(): void {
    this.open.set(true);
    // Если залогинены — предзаполняем email из /me и display_name из
    // client-profile. Лезем только один раз: повторное открытие модалки
    // не должно перетирать то что юзер успел поправить.
    if (this.auth.isLoggedIn() && !this.prefilled()) {
      this.auth.fetchMe().subscribe({
        next: (me) => {
          if (me.email && !this.email) this.email = me.email;
          this.prefilled.set(true);
        },
        error: () => this.prefilled.set(true),
      });
      this.profileApi.get().subscribe({
        next: (p) => {
          if (p.display_name && !this.name) this.name = p.display_name;
        },
        error: () => {},
      });
    }
  }

  public submit(): void {
    if (!this.canSend()) {
      this.msg.warning('Заполните email (от 4 символов) и сообщение (от 10 символов)');
      return;
    }
    this.busy.set(true);
    const payload: SupportMessagePayload = {
      from_email: this.email.trim(),
      from_name: this.name.trim() || undefined,
      topic: this.topic,
      message: this.message.trim(),
      source_url:
        typeof window !== 'undefined' ? window.location.href : undefined,
    };
    this.api.send(payload).subscribe({
      next: () => {
        this.msg.success('Спасибо! Мы ответим на указанный email.');
        this.message = '';
        this.open.set(false);
        this.busy.set(false);
      },
      error: (e: HttpErrorResponse) => {
        const body = e.error ?? null;
        const detail = body?.message || body?.error || `статус ${e.status}` || 'попробуйте позже';
        this.msg.error(`Не удалось отправить — ${detail}`);
        this.busy.set(false);
      },
    });
  }

  public year(): number {
    return new Date().getFullYear();
  }
}
