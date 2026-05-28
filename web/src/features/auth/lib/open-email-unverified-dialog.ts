import { HttpErrorResponse } from '@angular/common/http';
import { NzModalService } from 'ng-zorro-antd/modal';
import { EmailUnverifiedDialogComponent } from '../ui/email-unverified/email-unverified.dialog';

export function isEmailUnverifiedError(err: unknown): err is HttpErrorResponse {
  const e = err as HttpErrorResponse | undefined;
  return !!e && e.status === 403 && e.error?.error === 'email_unverified';
}

export function openEmailUnverifiedDialog(modal: NzModalService): void {
  modal.create({
    nzTitle: 'Подтвердите email',
    nzContent: EmailUnverifiedDialogComponent,
    nzFooter: null,
    nzWidth: 480,
    nzCentered: true,
    nzMaskClosable: true,
  });
}
