import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzInputModule } from 'ng-zorro-antd/input';
import { NzFormModule } from 'ng-zorro-antd/form';
import { NzMessageService } from 'ng-zorro-antd/message';
import { EMPTY } from 'rxjs';
import { catchError, finalize } from 'rxjs/operators';
import { AuthSessionStore } from '@entities/auth/model/auth-session.store';
import { apiErrorMessage } from '@shared/api/api-error';
import { AppHeaderComponent } from '@widgets/app-header/app-header.component';

@Component({
  selector: 'app-reset-password-page',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    RouterLink,
    NzButtonModule,
    NzInputModule,
    NzFormModule,
    AppHeaderComponent,
  ],
  templateUrl: './reset-password.page.html',
  styleUrl: './reset-password.page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ResetPasswordPage implements OnInit {
  private readonly route = inject(ActivatedRoute);

  private readonly router = inject(Router);

  private readonly fb = inject(FormBuilder);

  private readonly auth = inject(AuthSessionStore);

  private readonly msg = inject(NzMessageService);

  public readonly loading = signal(false);

  public readonly passwordVisible = signal(false);

  public readonly token = signal('');

  public readonly form = this.fb.group({
    password: ['', [Validators.required, Validators.minLength(8)]],
    confirm: ['', [Validators.required]],
  });

  public ngOnInit(): void {
    const t = (this.route.snapshot.queryParamMap.get('token') ?? '').trim();
    this.token.set(t);
    if (!t) {
      this.msg.error('Ссылка некорректна — токен отсутствует.');
    }
  }

  public togglePassword(): void {
    this.passwordVisible.update((v) => !v);
  }

  public submit(): void {
    if (this.form.invalid) return;
    const { password, confirm } = this.form.getRawValue();
    if (password !== confirm) {
      this.msg.error('Пароли не совпадают.');
      return;
    }
    if (!this.token()) return;
    this.loading.set(true);
    this.auth
      .confirmPasswordReset(this.token(), password!)
      .pipe(
        catchError((e) => {
          this.msg.error(apiErrorMessage(e.error, 'Не удалось сбросить пароль'));
          return EMPTY;
        }),
        finalize(() => this.loading.set(false)),
      )
      .subscribe(() => {
        this.msg.success('Пароль обновлён. Вы вошли в аккаунт.');
        this.router.navigate(['/']);
      });
  }
}
