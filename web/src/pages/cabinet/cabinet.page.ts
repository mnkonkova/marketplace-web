import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { NzSpinModule } from 'ng-zorro-antd/spin';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzInputModule } from 'ng-zorro-antd/input';
import { NzTagModule } from 'ng-zorro-antd/tag';
import { NzAlertModule } from 'ng-zorro-antd/alert';
import { NzMessageService } from 'ng-zorro-antd/message';
import { EMPTY, Observable, firstValueFrom, of } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { AuthSessionStore } from '@entities/auth/model/auth-session.store';
import { MeUser } from '@entities/auth/model/auth.types';
import { MeRepository } from '@entities/me/repository/me.repository';
import { putFileToPresignedUrl } from '@entities/me/repository/me-upload';
import {
  MeProfile,
  MeProfileFullPatch,
  ProfileCheckResult,
  UploadURLResponse,
} from '@entities/me/model/me.types';
import { CategoryApi } from '@entities/category/api/category.api';
import { Category, Skill } from '@entities/category/model/category.types';
import { PortfolioItem } from '@entities/specialist/model/specialist.types';
import { ApiErrorBody, apiErrorMessage } from '@shared/api/api-error';
import { groupCategoriesByType } from '@shared/lib/category-groups';
import { AppHeaderComponent } from '@widgets/app-header/app-header.component';

interface ProfileForm {
  display_name: string;
  bio: string;
  avatar_url?: string;
  city: string;
  rate_min: number | null;
  rate_max: number | null;
  currency: string;
  contact_email: string;
  contact_phone: string;
  updated_at?: string;
}

interface PortfolioForm {
  title: string;
  description: string;
  video_url: string;
  thumbnail_url: string;
}

@Component({
  selector: 'app-cabinet-page',
  standalone: true,
  imports: [
    FormsModule,
    NzSpinModule,
    NzButtonModule,
    NzInputModule,
    NzTagModule,
    NzAlertModule,
    AppHeaderComponent,
  ],
  templateUrl: './cabinet.page.html',
  styleUrl: './cabinet.page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CabinetPage implements OnInit {
  private readonly meRepo = inject(MeRepository);

  private readonly auth = inject(AuthSessionStore);

  private readonly router = inject(Router);

  private readonly categoryApi = inject(CategoryApi);

  private readonly msg = inject(NzMessageService);

  private readonly sessionStorage = window.sessionStorage;

  public readonly checkLoading = signal(false);

  public readonly user = signal<MeUser | null>(null);

  public readonly profile = signal<MeProfile | null>(null);

  public readonly categories = signal<Category[]>([]);

  public readonly skills = signal<Skill[]>([]);

  public readonly portfolio = signal<PortfolioItem[]>([]);

  public readonly loading = signal(true);

  public readonly saving = signal(false);

  public readonly portfolioSaving = signal(false);

  public readonly avatarUploading = signal(false);

  public readonly videoUploading = signal(false);

  public readonly videoUploadProgress = signal('');

  public readonly error = signal('');

  public readonly check = signal<ProfileCheckResult | null>(null);

  public readonly selectedCategories = signal<Set<string>>(new Set());

  public readonly primaryCategory = signal('');

  public readonly selectedSkills = signal<Set<string>>(new Set());

  public form: ProfileForm = {
    display_name: '',
    bio: '',
    city: '',
    rate_min: null,
    rate_max: null,
    currency: 'RUB',
    contact_email: '',
    contact_phone: '',
  };

  public portfolioForm: PortfolioForm = {
    title: '',
    description: '',
    video_url: '',
    thumbnail_url: '',
  };

  public readonly tools = computed(() => this.skills().filter((s) => s.kind !== 'platform'));

  public readonly platforms = computed(() => this.skills().filter((s) => s.kind === 'platform'));

  public readonly categoryGroups = computed(() => groupCategoriesByType(this.categories()));

  public ngOnInit(): void {
    if (!this.auth.isLoggedIn()) {
      this.router.navigate(['/']);
      return;
    }
    this.loadAll();
  }

  public logout(): void {
    this.auth.clear();
    this.router.navigate(['/']);
  }

  public categoryTitle(code: string): string {
    return this.categories().find((c) => c.code === code)?.title ?? code;
  }

  public toggleCategory(code: string): void {
    const next = new Set(this.selectedCategories());
    if (next.has(code)) {
      next.delete(code);
      if (this.primaryCategory() === code) {
        this.primaryCategory.set([...next][0] ?? '');
      }
    } else {
      next.add(code);
      if (!this.primaryCategory()) this.primaryCategory.set(code);
    }
    this.selectedCategories.set(next);
  }

  public setPrimary(code: string, ev: Event): void {
    ev.stopPropagation();
    const next = new Set(this.selectedCategories());
    next.add(code);
    this.selectedCategories.set(next);
    this.primaryCategory.set(code);
  }

  public toggleSkill(id: string): void {
    const next = new Set(this.selectedSkills());
    if (next.has(id)) next.delete(id);
    else next.add(id);
    this.selectedSkills.set(next);
  }

  public save(publish = false): void {
    this.error.set('');
    this.check.set(null);
    if (!this.form.display_name.trim()) {
      this.error.set('Имя/название не может быть пустым.');
      return;
    }
    if (
      this.form.rate_min != null &&
      this.form.rate_max != null &&
      this.form.rate_min > this.form.rate_max
    ) {
      this.error.set('Ставка «от» больше «до».');
      return;
    }
    if (publish && !this.selectedCategories().size) {
      this.error.set('Выберите хотя бы одну категорию перед публикацией.');
      return;
    }
    if (publish && !this.form.bio.trim()) {
      this.error.set('Заполните описание перед публикацией.');
      return;
    }
    this.saving.set(true);

    // Одной транзакцией: профиль + категории + навыки под одним updated_at.
    // Раньше шла цепочка из трёх запросов и updated_at между ними расходился —
    // второй/третий получали 409. См. backend handler PatchFull.
    const codes = [...this.selectedCategories()];
    const payload: MeProfileFullPatch = {
      display_name: this.form.display_name.trim(),
      bio: this.form.bio,
      avatar_url: this.form.avatar_url?.trim() ?? '',
      city: this.form.city.trim(),
      currency: (this.form.currency || 'RUB').trim().toUpperCase(),
      contact_email: this.form.contact_email.trim(),
      contact_phone: this.form.contact_phone.trim(),
      rate_min: this.form.rate_min ?? null,
      rate_max: this.form.rate_max ?? null,
      skills: { skill_ids: [...this.selectedSkills()] },
      updated_at: this.sessionStorage.getItem('updated_at') ?? undefined,
    };
    if (codes.length) {
      payload.categories = { codes, primary: this.primaryCategory() || codes[0] };
    }

    this.meRepo
      .patchProfileFull(payload)
      .pipe(
        catchError((err) => {
          this.failSave(err);
          return EMPTY;
        }),
      )
      .subscribe((p) => {
        this.setUpdatedAt(p.updated_at);
        if (publish) {
          this.publish();
        } else {
          this.doneSave(p, 'Сохранено');
        }
      });
  }

  public unpublish(): void {
    this.saving.set(true);
    this.meRepo
      .unpublishProfile()
      .pipe(
        catchError((err) => {
          this.failSave(err);
          return EMPTY;
        }),
      )
      .subscribe((p) => {
        this.applyProfile(p);
        this.saving.set(false);
        this.msg.success('Профиль снят с публикации');
      });
  }

  public runCheck(): void {
    this.checkLoading.set(true);
    this.check.set(null);
    this.error.set('');
    if (!this.form.display_name.trim() && !this.form.bio.trim()) {
      this.error.set('Заполните имя или описание перед проверкой.');
      return;
    }
    this.meRepo
      .checkProfile(this.form.display_name, this.form.bio)
      .pipe(
        catchError((err) => {
          this.error.set(apiErrorMessage(err.error, 'Проверка временно недоступна'));
          this.check.set(null);
          this.checkLoading.set(false);
          return of<ProfileCheckResult | null>(null);
        }),
      )
      .subscribe((result) => {
        if (result) {
          this.msg.success('Проверка профиля завершена');
          this.error.set('');
          this.check.set(result);
          this.checkLoading.set(false);
        }
      });
  }

  public uploadAvatar(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) {
      this.error.set('Аватар: поддерживаем jpg, png или webp.');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      this.error.set('Аватар больше 5 МБ.');
      return;
    }
    this.avatarUploading.set(true);
    this.uploadViaPresign(() => this.meRepo.presignAvatarUpload(file), file)
      .then((publicURL) => {
        this.form.avatar_url = publicURL;
        this.msg.success('Аватар загружен. Нажмите «Сохранить», чтобы применить.');
      })
      .catch((err: Error) => this.error.set(`Не удалось загрузить аватар: ${err.message}`))
      .finally(() => this.avatarUploading.set(false));
  }

  public clearAvatar(): void {
    this.form.avatar_url = '';
    this.msg.info('Аватар будет очищен после сохранения профиля.');
  }

  public uploadPortfolioFile(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    if (!/^video\/(mp4|quicktime)$/.test(file.type)) {
      this.error.set('Видео: поддерживаем mp4 и mov.');
      return;
    }
    if (file.size > 50 * 1024 * 1024) {
      this.error.set('Видео больше 50 МБ.');
      return;
    }
    const derivedTitle = file.name.replace(/\.(mp4|mov)$/i, '');
    this.portfolioForm.title = this.portfolioForm.title.trim() || derivedTitle;
    this.videoUploading.set(true);
    this.videoUploadProgress.set('0%');
    this.uploadViaPresign(
      () => this.meRepo.presignPortfolioUpload(file),
      file,
      (pct) => this.videoUploadProgress.set(`${pct}%`),
    )
      .then((publicURL) => {
        this.portfolioForm.video_url = publicURL;
        this.msg.success('Видео загружено. Проверьте заголовок и добавьте его в портфолио.');
      })
      .catch((err: Error) => this.error.set(`Не удалось загрузить видео: ${err.message}`))
      .finally(() => {
        this.videoUploading.set(false);
        setTimeout(() => this.videoUploadProgress.set(''), 1200);
      });
  }

  public addPortfolio(): void {
    if (!this.portfolioForm.video_url.trim() || !this.portfolioForm.title.trim()) {
      this.error.set('Для видео нужны ссылка и заголовок.');
      return;
    }
    this.portfolioSaving.set(true);
    this.meRepo
      .addPortfolio({
        ...this.portfolioForm,
        category_codes: this.primaryCategory() ? [this.primaryCategory()] : [],
      })
      .pipe(
        catchError((err) => {
          this.portfolioSaving.set(false);
          this.error.set(apiErrorMessage(err.error, 'Не удалось добавить видео'));
          return EMPTY;
        }),
      )
      .subscribe(() => {
        this.portfolioForm = { title: '', description: '', video_url: '', thumbnail_url: '' };
        this.loadPortfolio();
        this.portfolioSaving.set(false);
        this.msg.success('Видео добавлено');
      });
  }

  public deletePortfolio(id: string): void {
    this.meRepo
      .deletePortfolio(id)
      .pipe(
        catchError((err) => {
          this.error.set(apiErrorMessage(err.error, 'Не удалось удалить видео'));
          return EMPTY;
        }),
      )
      .subscribe(() => {
        this.portfolio.update((items) => items.filter((p) => p.id !== id));
        this.msg.success('Видео удалено');
      });
  }

  public togglePortfolioCategory(item: PortfolioItem, code: string): void {
    const next = new Set(item.category_codes ?? []);
    if (next.has(code)) next.delete(code);
    else next.add(code);
    this.meRepo
      .updatePortfolioCategories(item.id, [...next])
      .pipe(
        catchError((err) => {
          this.error.set(apiErrorMessage(err.error, 'Не удалось обновить категории видео'));
          return EMPTY;
        }),
      )
      .subscribe((updated) => {
        this.portfolio.update((items) => items.map((p) => (p.id === updated.id ? updated : p)));
      });
  }

  private loadAll(): void {
    this.loading.set(true);
    this.meRepo
      .getUser()
      .pipe(
        catchError(() => {
          this.auth.clear();
          void this.router.navigate(['/']);
          return EMPTY;
        }),
      )
      .subscribe((u) => {
        this.user.set(u);
      });
    this.categoryApi.list().subscribe((items) => this.categories.set(items));
    this.categoryApi.skills().subscribe((items) => this.skills.set(items));
    this.meRepo
      .getProfile()
      .pipe(
        catchError((err) => {
          this.loading.set(false);
          this.error.set(apiErrorMessage(err.error, 'Не удалось загрузить профиль'));
          return EMPTY;
        }),
      )
      .subscribe((p) => {
        console.log(p);
        this.setUpdatedAt(p.updated_at);
        this.applyProfile(p);
        this.loadPortfolio();
        this.loading.set(false);
      });
  }

  private setUpdatedAt(updated_at: string): void {
    this.sessionStorage.setItem('updated_at', updated_at);
  }

  private loadPortfolio(): void {
    this.meRepo
      .listPortfolio()
      .pipe(
        catchError(() => {
          this.portfolio.set([]);
          return EMPTY;
        }),
      )
      .subscribe((items) => this.portfolio.set(items));
  }

  private applyProfile(p: MeProfile): void {
    this.profile.set(p);
    this.form = {
      display_name: p.display_name ?? '',
      bio: p.bio ?? '',
      avatar_url: p.avatar_url ?? '',
      city: p.city ?? '',
      rate_min: p.rate_min ?? null,
      rate_max: p.rate_max ?? null,
      currency: p.currency || 'RUB',
      contact_email: p.contact_email ?? '',
      contact_phone: p.contact_phone ?? '',
    };
    this.selectedCategories.set(new Set(p.categories ?? []));
    this.primaryCategory.set(p.primary_category || p.categories?.[0] || '');
    this.selectedSkills.set(new Set(p.skill_ids ?? []));
  }


  private publish(): void {
    this.meRepo
      .publishProfile()
      .pipe(
        catchError((err) => {
          if (err.status === 422 && err.error?.check) {
            this.check.set(err.error.check);
          }
          this.failSave(err);
          return EMPTY;
        }),
      )
      .subscribe((p) => this.doneSave(p, 'Профиль опубликован'));
  }

  private doneSave(p: MeProfile, message: string): void {
    this.applyProfile(p);
    this.saving.set(false);
    this.msg.success(message);
  }

  private failSave(err: { error?: ApiErrorBody | null }): void {
    this.saving.set(false);
    const message = apiErrorMessage(err.error ?? null, 'Не удалось сохранить');
    this.error.set(message);
    this.msg.error(message);
  }

  private uploadViaPresign(
    presign: () => Observable<UploadURLResponse>,
    file: File,
    onProgress?: (percent: number) => void,
  ): Promise<string> {
    return firstValueFrom(presign()).then((res) =>
      putFileToPresignedUrl(res.upload_url, file, onProgress).then(() => res.public_url),
    );
  }
}
