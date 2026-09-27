import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { NzMessageService } from 'ng-zorro-antd/message';

import { OrderApi } from '@entities/order/api/order.api';
import { Invitation, ResponseMode } from '@entities/order/model/order.types';
import { MeRepository } from '@entities/me/repository/me.repository';
import { PortfolioItem } from '@entities/specialist/model/specialist.types';
import { plural } from '@shared/lib/format';
import { AuthSessionStore } from '@entities/auth/model/auth-session.store';
import { parseApiError } from '@shared/api/api-error';
import { AppHeaderComponent } from '@widgets/app-header/app-header.component';
import {
  PrMarketNavItem,
  PrMarketTopComponent,
} from '@widgets/prmarket-top/prmarket-top.component';

/**
 * «Заявки» креатора: что предлагают снять и чем на это ответить.
 *
 * Раньше приглашение было именным и отвечать на него полагалось
 * галочкой «согласен»: заказчик расставлял людей по приоритету, место
 * ждало одного человека трое суток, и остальные в это время не знали о
 * заявке вовсе. Теперь заявка уходит рассылкой ВСЕМ, и ответ на неё —
 * не согласие, а работа: ролик под эту задачу или уже снятое из
 * портфолио. Состав из откликнувшихся собирает менеджер.
 *
 * Отсюда и устройство экрана. Отклик не обещает места: мы говорим
 * «менеджер соберёт состав», а не «вы в проекте». Отметку «хотят
 * особенно» показываем — она единственное, что заказчик сказал о
 * людях, — но и она не обещание.
 */
@Component({
  selector: 'app-creator-invitations-page',
  standalone: true,
  imports: [CommonModule, FormsModule, AppHeaderComponent, PrMarketTopComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './creator-invitations.page.html',
  styleUrl: './creator-invitations.page.scss',
})
export class CreatorInvitationsPage {
  private readonly api = inject(OrderApi);

  private readonly me = inject(MeRepository);

  private readonly http = inject(HttpClient);

  private readonly msg = inject(NzMessageService);

  private readonly auth = inject(AuthSessionStore);

  public readonly loading = signal(true);

  public readonly items = signal<Invitation[]>([]);

  /** Открытая заявка: отвечают по одной, форма рисуется в её строке. */
  public readonly openID = signal('');

  /** Что человек выбрал в открытой форме. */
  public readonly mode = signal<ResponseMode | ''>('');

  public note = '';

  public readonly portfolio = signal<PortfolioItem[]>([]);

  public readonly picked = signal<ReadonlySet<string>>(new Set());

  public readonly busy = signal(false);

  /** Прогресс загрузки файла, 0–100. Пусто — не грузим. */
  public readonly uploading = signal(0);

  public constructor() {
    this.reload();
  }

  private reload(): void {
    this.api.invitations().subscribe({
      next: (r) => {
        this.items.set(r.items ?? []);
        this.loading.set(false);
      },
      error: (e) => {
        this.loading.set(false);
        this.msg.error(parseApiError(e, 'Не удалось загрузить заявки.').message);
      },
    });
  }

  public readonly nav = computed<readonly PrMarketNavItem[]>(() => [
    { title: 'Мои проекты', link: '/me/creator/projects' },
    { title: 'Заявки', link: '/me/creator/invitations', current: true },
    // «Веду» — для тех, кто ещё и менеджер. Один человек с двумя
    // шляпами: здесь его собственные съёмки, там — проекты, которые
    // он ведёт. В мини-аппе это единственный способ перейти между
    // ними: шапки сайта там нет.
    ...(this.auth.hasRole('manager')
      ? [{ title: 'Веду', link: '/manager/projects' } as PrMarketNavItem]
      : []),
  ]);

  /** Сколько заявок ждут ответа: их и видно в шапке. */
  public readonly waiting = computed(() => this.items().filter((i) => !i.responded).length);

  public readonly subtitle = computed(() => {
    const n = this.waiting();
    if (!n) return '';
    return `${n} ${plural(n, 'заявка ждёт', 'заявки ждут', 'заявок ждут')} ответа`;
  });

  public monthTitle(iv: Invitation): string {
    const d = new Date(iv.start_month);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' });
  }

  public answerLabel(iv: Invitation): string {
    switch (iv.responded) {
      case 'attach':
      case 'upload':
        return 'вы прислали ролик';
      case 'from_portfolio':
        return 'вы показали свои ролики';
      case 'decline':
        return 'вы отказались';
      default:
        return '';
    }
  }

  /** Открыть форму ответа. Портфолио тянем один раз и на все заявки. */
  public open(iv: Invitation): void {
    this.openID.set(iv.order_id);
    this.mode.set('');
    this.note = '';
    this.picked.set(new Set());
    if (!this.portfolio().length) {
      this.me.listPortfolio().subscribe({
        next: (items) => this.portfolio.set(items.filter((i) => !!i.video_url)),
        // Молча: «отправить из моих» просто не покажет роликов, а два
        // других способа ответа от этого не зависят.
        error: () => this.portfolio.set([]),
      });
    }
  }

  public close(): void {
    this.openID.set('');
    this.mode.set('');
    this.uploading.set(0);
  }

  public choose(mode: ResponseMode): void {
    this.mode.set(mode);
  }

  public togglePick(id: string): void {
    const next = new Set(this.picked());
    if (!next.delete(id)) next.add(id);
    this.picked.set(next);
  }

  public isPicked(id: string): boolean {
    return this.picked().has(id);
  }

  /**
   * Файл: presign → PUT в бакет → отклик со ссылкой.
   *
   * Одним PUT и до 50 МБ — как в портфолио. Большего для пробы работы
   * не нужно: это ролик на минуту, а не исходники.
   */
  public onFile(ev: Event, iv: Invitation): void {
    const input = ev.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    if (file.size > 50 * 1024 * 1024) {
      this.msg.error('Файл больше 50 МБ — пришлите ролик полегче.');
      return;
    }
    this.busy.set(true);
    this.uploading.set(1);
    this.api.workSampleUploadUrl(file.type, file.size).subscribe({
      next: (presign) => {
        this.http
          .put(presign.upload_url, file, { headers: { 'Content-Type': file.type } })
          .subscribe({
            next: () => {
              this.uploading.set(100);
              this.send(iv, 'attach', presign.public_url);
            },
            error: () => {
              this.busy.set(false);
              this.uploading.set(0);
              this.msg.error('Не удалось загрузить файл. Попробуйте ещё раз.');
            },
          });
      },
      error: (e) => {
        this.busy.set(false);
        this.uploading.set(0);
        this.msg.error(parseApiError(e, 'Не удалось получить ссылку на загрузку.').message);
      },
    });
  }

  public sendPortfolio(iv: Invitation): void {
    if (!this.picked().size) return;
    this.send(iv, 'from_portfolio');
  }

  public decline(iv: Invitation): void {
    this.send(iv, 'decline');
  }

  private send(iv: Invitation, mode: ResponseMode, fileURL?: string): void {
    this.busy.set(true);
    this.api
      .respondWithWork(iv.order_id, {
        mode,
        file_url: fileURL,
        portfolio_items: mode === 'from_portfolio' ? [...this.picked()] : undefined,
        note: this.note.trim() || undefined,
      })
      .subscribe({
        next: () => {
          this.busy.set(false);
          this.uploading.set(0);
          this.close();
          this.msg.success(
            mode === 'decline'
              ? 'Спасибо, что ответили — заявку больше не покажем.'
              : 'Отклик у менеджера. Он соберёт состав и напишет.',
          );
          this.reload();
        },
        error: (e) => {
          this.busy.set(false);
          this.uploading.set(0);
          this.msg.error(parseApiError(e, 'Не удалось отправить отклик.').message);
        },
      });
  }
}
