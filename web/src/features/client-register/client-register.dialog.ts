import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { EMPTY, catchError, finalize } from 'rxjs';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzInputModule } from 'ng-zorro-antd/input';
import { NzModalRef, NzModalService } from 'ng-zorro-antd/modal';

import { AuthSessionStore } from '@entities/auth/model/auth-session.store';
import { AuthDialogComponent } from '@features/auth/ui/auth.dialog';
import { apiErrorMessage } from '@shared/api/api-error';

/**
 * Регистрация заказчика — одним окном, без мастера.
 *
 * У спроса и предложения разная цена входа. Специалисту мастер оправдан: он
 * там собирает профиль, ради которого и пришёл. Заказчику собирать нечего —
 * ему нужен поиск, и каждый лишний экран до него стоит конверсии. Поэтому
 * здесь три поля и сразу /search.
 *
 * Механизм тот же, что у специалиста: POST /auth/register, отличается только
 * kind. Параллельного стора нет.
 */
@Component({
  selector: 'app-client-register-dialog',
  standalone: true,
  imports: [ReactiveFormsModule, NzInputModule, NzButtonModule],
  templateUrl: './client-register.dialog.html',
  styleUrl: './client-register.dialog.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ClientRegisterDialog {
  private readonly fb = inject(FormBuilder);

  private readonly auth = inject(AuthSessionStore);

  private readonly router = inject(Router);

  private readonly modal = inject(NzModalService);

  private readonly ref = inject(NzModalRef);

  public readonly loading = signal(false);

  public readonly backendError = signal('');

  public readonly form = this.fb.group({
    display_name: ['', Validators.required],
    email: ['', [Validators.required, Validators.email]],
    // Минимум длины не дублируем: его знает бэкенд и вернёт понятным
    // сообщением. Своя проверка рассинхронизируется при первом же изменении.
    password: ['', Validators.required],
  });

  public submit(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    this.backendError.set('');
    this.loading.set(true);
    const v = this.form.getRawValue();
    this.auth
      .register({
        email: v.email!,
        password: v.password!,
        display_name: v.display_name!,
        kind: 'client',
        source: 'client_modal',
      })
      .pipe(
        catchError((err) => {
          this.backendError.set(apiErrorMessage(err?.error, 'Не удалось зарегистрироваться'));
          return EMPTY;
        }),
        finalize(() => this.loading.set(false)),
      )
      .subscribe(() => {
        this.ref.close(true);
        // Заказчику нужен поиск, а не кабинет: там он и так ничего не
        // заполняет, а команду ищет здесь.
        void this.router.navigate(['/search']);
      });
  }

  public openLogin(): void {
    this.ref.close(false);
    this.modal.create({
      nzContent: AuthDialogComponent,
      nzFooter: null,
      nzWidth: 'min(420px, 92vw)',
      nzData: { initialTab: 0 },
    });
  }

  /** Специалисту здесь делать нечего — уводим в его мастер. */
  public goSpecialist(): void {
    this.ref.close(false);
    void this.router.navigate(['/start'], { queryParams: { role: 'specialist' } });
  }

  public cancel(): void {
    this.ref.close(false);
  }
}
