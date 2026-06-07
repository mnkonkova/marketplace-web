import { CommonModule } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzFormModule } from 'ng-zorro-antd/form';
import { NzInputModule } from 'ng-zorro-antd/input';
import { NzMessageService } from 'ng-zorro-antd/message';
import { NzModalModule } from 'ng-zorro-antd/modal';
import { NzSelectModule } from 'ng-zorro-antd/select';

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

  public readonly open = signal(false);
  public readonly busy = signal(false);

  public email = '';
  public name = '';
  public topic: SupportTopic = 'other';
  public message = '';

  public readonly canSend = computed(
    () => this.email.length > 3 && this.message.trim().length >= 10 && !this.busy(),
  );

  public openModal(): void {
    this.open.set(true);
  }

  public submit(): void {
    if (!this.canSend()) return;
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
        const detail = e.error?.error || 'попробуйте позже';
        this.msg.error(`Не удалось отправить — ${detail}`);
        this.busy.set(false);
      },
    });
  }

  public year(): number {
    return new Date().getFullYear();
  }
}
