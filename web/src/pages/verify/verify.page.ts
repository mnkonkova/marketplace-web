import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzResultModule } from 'ng-zorro-antd/result';
import { NzSpinModule } from 'ng-zorro-antd/spin';
import { EMPTY } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { AuthSessionStore } from '@entities/auth/model/auth-session.store';
import { apiErrorMessage, ApiErrorBody } from '@shared/api/api-error';
import { AppHeaderComponent } from '@widgets/app-header/app-header.component';

type State = 'loading' | 'success' | 'error';

@Component({
  selector: 'app-verify-page',
  standalone: true,
  imports: [
    AppHeaderComponent,
    NzButtonModule,
    NzResultModule,
    NzSpinModule,
    RouterLink,
  ],
  templateUrl: './verify.page.html',
  styleUrl: './verify.page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class VerifyPage implements OnInit {
  private readonly route = inject(ActivatedRoute);

  private readonly router = inject(Router);

  private readonly auth = inject(AuthSessionStore);

  protected readonly state = signal<State>('loading');

  protected readonly errorText = signal<string>('');

  public ngOnInit(): void {
    const token = (this.route.snapshot.queryParamMap.get('token') ?? '').trim();
    if (!token) {
      this.state.set('error');
      this.errorText.set('В ссылке нет токена. Откройте ссылку из письма целиком.');
      return;
    }
    this.auth
      .verifyEmail(token)
      .pipe(
        catchError((err: { error?: ApiErrorBody | null; status?: number }) => {
          this.state.set('error');
          // 410 token_invalid — самая частая причина: токен уже использован
          // (например, второй клик по той же ссылке) или истёк срок.
          const fallback =
            err.status === 410
              ? 'Ссылка устарела или уже использована. Запросите новое письмо в кабинете.'
              : 'Не удалось подтвердить email.';
          this.errorText.set(apiErrorMessage(err.error ?? null, fallback));
          return EMPTY;
        }),
      )
      .subscribe(() => this.state.set('success'));
  }

  protected goToCabinet(): void {
    // На случай если fetchMe из verifyEmail ещё не успел отработать
    // (он subscribe без await) — повторно дёргаем перед навигацией и
    // ждём резолва. Гарантирует что Cabinet увидит kind/role в session.
    this.auth.fetchMe().subscribe({
      next: () => void this.router.navigate(['/me']),
      error: () => void this.router.navigate(['/me']),
    });
  }
}
