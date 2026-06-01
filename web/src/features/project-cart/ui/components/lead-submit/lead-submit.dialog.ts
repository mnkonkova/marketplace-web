import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { RouterLink } from '@angular/router';
import { NzDatePickerModule } from 'ng-zorro-antd/date-picker';
import { NzModalRef, NzModalService } from 'ng-zorro-antd/modal';
import { EMPTY } from 'rxjs';
import { catchError, finalize } from 'rxjs/operators';
import { API_URL } from '@shared/api/api-url.token';
import { apiErrorMessage } from '@shared/api/api-error';
import { CreateLeadResponse, LeadSubmitFormValue } from '@features/project-cart/model/lead.types';
import { ProjectCartStore } from '@features/project-cart/model/project-cart.store';
import { buildCreateLeadPayload } from '@features/project-cart/lib/build-create-lead-payload';
import { buildLeadSuccessMessage } from '@features/project-cart/lib/build-lead-success-message';
import {
  isEmailUnverifiedError,
  openEmailUnverifiedDialog,
} from '@features/auth/lib/open-email-unverified-dialog';
import { AuthSessionStore } from '@entities/auth/model/auth-session.store';
import { ClientProfileApi } from '@entities/me/api/client-profile.api';
import { LeadSuccessDialogComponent } from '../lead-success/lead-success.dialog';

@Component({
  selector: 'app-lead-submit-dialog',
  standalone: true,
  imports: [ReactiveFormsModule, NzDatePickerModule, RouterLink],
  templateUrl: './lead-submit.dialog.html',
  styleUrl: '../../project-dialog.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LeadSubmitDialogComponent {
  private readonly fb = inject(FormBuilder);

  private readonly http = inject(HttpClient);

  private readonly api = inject(API_URL);

  private readonly cart = inject(ProjectCartStore);

  private readonly modalService = inject(NzModalService);

  private readonly auth = inject(AuthSessionStore);

  private readonly clientProfileApi = inject(ClientProfileApi);

  public readonly modalRef = inject(NzModalRef);

  // Если юзер залогинен — поля контактов из формы убираем (они уже в
  // /me/client-profile). Если незалогинен — старая форма с полями.
  public readonly isLoggedIn = this.auth.isLoggedIn;

  public readonly specialists = this.cart.specialists;

  public readonly loading = signal(false);

  public readonly error = signal('');

  public readonly form = this.fb.group({
    client_name: [''],
    client_contact: [''],
    brief: ['', [Validators.required]],
    budget_min: [null as number | null],
    budget_max: [null as number | null],
    deadline: [null as Date | null],
  });

  public constructor() {
    if (this.isLoggedIn()) {
      // Подтянем контакты из профиля; если пусто — поле остаётся пустым, и
      // юзеру покажем ссылку «заполнить контакты».
      this.clientProfileApi.get().subscribe((cp) => {
        this.form.patchValue({
          client_name: cp.display_name || '',
          client_contact: cp.telegram || cp.phone || '',
        });
      });
    } else {
      // Анонимный бриф — контакты обязательные.
      this.form.controls.client_name.addValidators([
        Validators.required,
        Validators.minLength(2),
      ]);
      this.form.controls.client_contact.addValidators([Validators.required]);
    }
  }

  public readonly disabledPastDates = (current: Date): boolean => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return current < today;
  };

  public submit(): void {
    if (this.form.invalid || !this.specialists().length) return;
    this.loading.set(true);
    this.error.set('');
    const specialists = this.specialists();
    const formValue = this.form.getRawValue() as LeadSubmitFormValue;
    const payload = buildCreateLeadPayload(
      formValue,
      specialists.map((s) => s.user_id),
    );
    this.http
      .post<CreateLeadResponse>(`${this.api}/leads`, payload)
      .pipe(
        catchError((err) => {
          if (isEmailUnverifiedError(err)) {
            openEmailUnverifiedDialog(this.modalService);
            return EMPTY;
          }
          this.error.set(apiErrorMessage(err.error, 'Не удалось отправить заявку'));
          return EMPTY;
        }),
        finalize(() => this.loading.set(false)),
      )
      .subscribe((res) => {
        const message = buildLeadSuccessMessage(specialists, formValue.client_contact);
        this.cart.clear();
        this.modalRef.destroy();
        this.modalService.create({
          nzContent: LeadSuccessDialogComponent,
          nzData: {
            message,
            specialists: res.specialists ?? [],
          },
          nzFooter: null,
          nzWidth: 540,
          nzClassName: 'project-modal',
          nzCentered: true,
        });
      });
  }
}
