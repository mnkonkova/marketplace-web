import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzModalModule, NzModalRef } from 'ng-zorro-antd/modal';
import { NzMessageService } from 'ng-zorro-antd/message';
import { EMPTY } from 'rxjs';
import { catchError, finalize } from 'rxjs/operators';
import { AuthSessionStore } from '@entities/auth/model/auth-session.store';
import { apiErrorMessage } from '@shared/api/api-error';

@Component({
  selector: 'app-email-unverified-dialog',
  standalone: true,
  imports: [NzModalModule, NzButtonModule],
  templateUrl: './email-unverified.dialog.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EmailUnverifiedDialogComponent {
  private readonly auth = inject(AuthSessionStore);

  private readonly msg = inject(NzMessageService);

  public readonly modal = inject(NzModalRef);

  public readonly loading = signal(false);

  public readonly sent = signal(false);

  public resend(): void {
    this.loading.set(true);
    this.auth
      .resendVerification()
      .pipe(
        catchError((e: HttpErrorResponse) => {
          if (e.status === 429) {
            this.msg.warning('Слишком часто. Подождите минуту и попробуйте снова.');
          } else {
            this.msg.error(apiErrorMessage(e.error, 'Не удалось отправить письмо'));
          }
          return EMPTY;
        }),
        finalize(() => this.loading.set(false)),
      )
      .subscribe(() => {
        this.sent.set(true);
        this.msg.success('Письмо отправлено');
      });
  }

  public close(): void {
    this.modal.destroy();
  }
}
