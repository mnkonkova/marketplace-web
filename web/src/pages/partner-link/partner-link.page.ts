import { ChangeDetectionStrategy, Component, OnInit, effect, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { NzModalService } from 'ng-zorro-antd/modal';
import { finalize } from 'rxjs/operators';
import { AuthSessionStore } from '@entities/auth/model/auth-session.store';
import { AuthDialogComponent } from '@features/auth/ui/auth.dialog';
import { API_URL } from '@shared/api/api-url.token';
import { AppHeaderComponent } from '@widgets/app-header/app-header.component';

/** Подтверждение аккаунта для «Бота Работ».
 *
 * Человек приходит сюда по одноразовой ссылке из мини-приложения. Смысл
 * страницы в одном: он здесь залогинен, значит аккаунт действительно его —
 * и подтвердить это может сайт, а не он сам, вводя почту в чужом окне.
 *
 * Три состояния, и все три — обычная дорога, а не ошибка:
 *   · залогинен → одна кнопка;
 *   · есть аккаунт, но не вошёл → вход, после которого код никуда не делся;
 *   · аккаунта нет → регистрация в том же окне.
 *
 * Почта должна быть подтверждена. Иначе скидку получал бы любой, кто
 * зарегистрировался на выдуманный адрес, — то есть проверка стала бы
 * формальностью, ради которой всё и затевалось.
 */
@Component({
  selector: 'app-partner-link-page',
  standalone: true,
  imports: [NzButtonModule, NzIconModule, AppHeaderComponent],
  templateUrl: './partner-link.page.html',
  styleUrl: './partner-link.page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PartnerLinkPage implements OnInit {
  private readonly route = inject(ActivatedRoute);

  private readonly http = inject(HttpClient);

  private readonly api = inject(API_URL);

  private readonly modal = inject(NzModalService);

  private readonly router = inject(Router);

  public readonly auth = inject(AuthSessionStore);

  public readonly code = signal('');

  public readonly busy = signal(false);

  public readonly done = signal(false);

  /** Что пошло не так — человеческим языком и с понятным следующим шагом. */
  public readonly problem = signal('');

  /** Пробовали ли подтвердить сами. Обычное поле, а не сигнал, и это важно:
   *  сигнал внутри effect стал бы его зависимостью, и эффект перезапускал бы
   *  сам себя — запрос, ответ, снова запрос. Ровно так страница и зависла на
   *  «Подтвердить»: при любой ошибке она уходила в вечный круг. */
  private tried = false;

  public constructor() {
    // Вошёл прямо на этой странице — подтверждаем сразу, без второго нажатия:
    // он уже нажал «Привязать» в приложении, повторять просьбу незачем.
    // Ровно один раз: дальше решает человек кнопкой.
    effect(() => {
      if (this.auth.isLoggedIn() && this.code() && !this.tried) {
        this.tried = true;
        this.confirm();
      }
    });
  }

  public ngOnInit(): void {
    this.code.set(this.route.snapshot.paramMap.get('code') ?? '');
    if (!this.code()) {
      this.problem.set('Ссылка неполная. Откройте её из приложения заново.');
    }
  }

  public login(): void {
    this.modal.create({
      nzContent: AuthDialogComponent,
      nzFooter: null,
      nzWidth: 'min(420px, 92vw)',
      nzData: { initialTab: 0 },
    });
  }

  /** Аккаунта нет — уводим в регистрацию специалиста.
   *
   *  Не окном поверх этой страницы: аккаунт заводят один раз и вместе с
   *  профилем, а не ради подтверждения кода. И всё равно привязка требует
   *  подтверждённой почты — код, выданный сейчас, до клика по письму не
   *  доживёт. Честнее сказать это сразу и позвать вернуться из бота, чем
   *  показать отказ уже после регистрации.
   */
  public signup(): void {
    // Код едет с человеком: лендинг пробрасывает его в мастер, мастер
    // запоминает и предлагает привязку на последнем шаге, когда почта уже
    // подтверждена. Без этого человеку пришлось бы возвращаться в бот за
    // новой ссылкой — то есть проходить регистрацию и бросать её на полпути.
    void this.router.navigate(['/for-specialists'], {
      queryParams: { link: this.code() },
    });
  }

  public confirm(): void {
    if (!this.code() || this.busy()) return;
    this.busy.set(true);
    this.problem.set('');

    this.http
      .post(`${this.api}/partner/telegram-link`, { code: this.code() })
      .pipe(finalize(() => this.busy.set(false)))
      .subscribe({
        next: () => this.done.set(true),
        error: (err: HttpErrorResponse) => {
          // Показываем причину и оставляем кнопку: почти все отказы здесь —
          // «сделайте ещё шаг», а не «всё сломалось».
          this.problem.set(this.explain(err));
          console.error('partner link failed', err.status, err.error);
        },
      });
  }

  /** Текст ошибки выбираем по коду, а не по статусу: человеку нужен не
   *  диагноз, а следующее действие. */
  private explain(err: HttpErrorResponse): string {
    switch (err.error?.error) {
      case 'email_not_verified':
        return 'Сначала подтвердите почту — письмо со ссылкой мы отправляли при регистрации. Потом вернитесь сюда.';
      case 'code_rejected':
        return 'Ссылка устарела или уже использована. Откройте «Привязать аккаунт» в приложении заново.';
      case 'disabled':
        return 'Привязка временно недоступна. Напишите в поддержку.';
      default:
        return err.error?.message || 'Не получилось. Попробуйте ещё раз через минуту.';
    }
  }
}
