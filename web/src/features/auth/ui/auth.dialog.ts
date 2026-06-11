import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  inject,
  signal,
} from '@angular/core';
import { FormBuilder, FormsModule, ReactiveFormsModule, Validators } from '@angular/forms';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzFormModule } from 'ng-zorro-antd/form';
import { NzInputModule } from 'ng-zorro-antd/input';
import { NZ_MODAL_DATA, NzModalModule, NzModalRef } from 'ng-zorro-antd/modal';
import { NzTabsModule } from 'ng-zorro-antd/tabs';
import { NzMessageService } from 'ng-zorro-antd/message';
import { AuthSessionStore } from '@entities/auth/model/auth-session.store';
import { apiErrorMessage } from '@shared/api/api-error';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { NzRadioModule } from 'ng-zorro-antd/radio';
import { NzSelectModule } from 'ng-zorro-antd/select';
import { EMPTY } from 'rxjs';
import { catchError, finalize } from 'rxjs/operators';

@Component({
  selector: 'app-auth-dialog',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    NzModalModule,
    NzTabsModule,
    NzFormModule,
    NzInputModule,
    NzButtonModule,
    FormsModule,
    NzIconModule,
    NzRadioModule,
    NzSelectModule,
  ],
  templateUrl: './auth.dialog.html',
  styleUrl: './auth.dialog.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AuthDialogComponent {
  public passwordVisible = true;

  public password?: string;

  private readonly fb = inject(FormBuilder);

  private readonly auth = inject(AuthSessionStore);

  private readonly msg = inject(NzMessageService);

  public readonly modal = inject(NzModalRef);

  private readonly cdr = inject(ChangeDetectorRef);

  private readonly data = inject<{ initialTab?: number } | null>(NZ_MODAL_DATA, {
    optional: true,
  });

  public readonly tab = signal(this.data?.initialTab ?? 0);

  public readonly loading = signal(false);

  // forgot-режим: показываем мини-форму запроса reset вместо полей логина.
  // Toggle'ится из ссылки «Забыли пароль?» под полем пароля.
  public readonly forgotMode = signal(false);

  public readonly forgotSent = signal(false);

  public readonly loginForm = this.fb.group({
    login: ['', Validators.required],
    password: ['', Validators.required],
  });

  public readonly registerForm = this.fb.group({
    display_name: ['', Validators.required],
    email: ['', [Validators.required, Validators.email]],
    // minLength умышленно не ставим — backend знает актуальный минимум
    // (auth/service.go:127) и возвращает понятное `message` через
    // apiErrorMessage. Дублировать правило тут = риск рассинхрона:
    // backend бампнули до 10, фронт пускает 9 → юзер тыкается в 400.
    password: ['', Validators.required],
    kind: ['', Validators.required],
  });

  public readonly forgotForm = this.fb.group({
    email: ['', [Validators.required, Validators.email]],
  });

  public login(): void {
    if (this.loginForm.invalid) return;
    this.loading.set(true);
    this.auth
      .login(this.loginForm.getRawValue() as { login: string; password: string })
      .pipe(
        catchError((e) => {
          this.msg.error(apiErrorMessage(e.error, 'Ошибка входа'));
          return EMPTY;
        }),
        finalize(() => this.loading.set(false)),
      )
      .subscribe(() => {
        this.msg.success('Вы вошли', { nzDuration: 3000 });
        this.modal.destroy(true);
      });
  }

  public openForgot(): void {
    this.forgotMode.set(true);
    this.forgotSent.set(false);
    const login = this.loginForm.get('login')?.value ?? '';
    if (login.includes('@')) {
      this.forgotForm.patchValue({ email: login });
    }
  }

  public cancelForgot(): void {
    this.forgotMode.set(false);
    this.forgotSent.set(false);
  }

  public submitForgot(): void {
    if (this.forgotForm.invalid) return;
    this.loading.set(true);
    const email = this.forgotForm.value.email!;
    this.auth
      .requestPasswordReset(email)
      .pipe(
        catchError((e) => {
          this.msg.error(apiErrorMessage(e.error, 'Не удалось запросить сброс пароля'));
          return EMPTY;
        }),
        finalize(() => this.loading.set(false)),
      )
      .subscribe(() => {
        this.forgotSent.set(true);
      });
  }

  public register(): void {
    if (this.registerForm.invalid) {
      this.registerForm.markAllAsTouched();
      this.cdr.markForCheck();
      return;
    }
    this.loading.set(true);
    const v = this.registerForm.getRawValue();
    this.auth
      .register({
        email: v.email!,
        password: v.password!,
        display_name: v.display_name!,
        kind: v.kind! as 'client' | 'specialist',
      })
      .pipe(
        catchError((e) => {
          this.msg.error(apiErrorMessage(e.error, 'Ошибка регистрации'));
          return EMPTY;
        }),
        finalize(() => this.loading.set(false)),
      )
      .subscribe(() => {
        this.msg.success('Аккаунт создан');
        this.modal.destroy(true);
      });
  }
}
