import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormBuilder, FormsModule, ReactiveFormsModule, Validators } from '@angular/forms';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzFormModule } from 'ng-zorro-antd/form';
import { NzInputModule } from 'ng-zorro-antd/input';
import { NzModalModule, NzModalRef } from 'ng-zorro-antd/modal';
import { NzTabsModule } from 'ng-zorro-antd/tabs';
import { NzMessageService } from 'ng-zorro-antd/message';
import { AuthSessionStore } from '@entities/auth/model/auth-session.store';
import { apiErrorMessage } from '@shared/api/api-error';
import { NzIconModule } from 'ng-zorro-antd/icon';
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

  public readonly tab = signal(0);

  public readonly loading = signal(false);

  public readonly loginForm = this.fb.group({
    login: ['', Validators.required],
    password: ['', Validators.required],
  });

  public readonly registerForm = this.fb.group({
    display_name: ['', Validators.required],
    email: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required, Validators.minLength(6)]],
    kind: ['', Validators.required],
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

  public register(): void {
    if (this.registerForm.invalid) return;
    this.loading.set(true);
    const v = this.registerForm.getRawValue();
    this.auth
      .register({
        email: v.email!,
        password: v.password!,
        display_name: v.display_name!,
        kind: v.kind! as 'client' | 'specialist' | 'both',
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
