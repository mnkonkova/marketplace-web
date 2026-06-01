import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { AuthSessionStore } from '@entities/auth/model/auth-session.store';
import { NzCardModule } from 'ng-zorro-antd/card';
import { NzTagModule } from 'ng-zorro-antd/tag';
import { NzProgressModule } from 'ng-zorro-antd/progress';
import { NzSpinModule } from 'ng-zorro-antd/spin';
import { NzEmptyModule } from 'ng-zorro-antd/empty';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { NzInputModule } from 'ng-zorro-antd/input';
import { NzMessageService } from 'ng-zorro-antd/message';
import { FormsModule } from '@angular/forms';

import {
  ClientProfile,
  ClientProfileApi,
} from '@entities/me/api/client-profile.api';
import { ProjectApi } from '@entities/project/api/project.api';
import { ProjectClientView } from '@entities/project/model/project.types';
import {
  PROJECT_STATUS_COLOR,
  PROJECT_STATUS_LABEL,
} from '@shared/lib/project-status';
import { AppHeaderComponent } from '@widgets/app-header/app-header.component';

@Component({
  selector: 'app-projects-list-page',
  standalone: true,
  imports: [
    CommonModule,
    NzCardModule,
    NzTagModule,
    NzProgressModule,
    NzSpinModule,
    NzEmptyModule,
    NzIconModule,
    NzInputModule,
    NzButtonModule,
    FormsModule,
    AppHeaderComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './projects-list.page.html',
  styleUrl: './projects-list.page.scss',
})
export class ProjectsListPage {
  private readonly api = inject(ProjectApi);

  private readonly profileApi = inject(ClientProfileApi);

  private readonly router = inject(Router);

  private readonly auth = inject(AuthSessionStore);

  private readonly msg = inject(NzMessageService);

  public readonly loading = signal(true);

  public readonly projects = signal<ProjectClientView[]>([]);

  public readonly contacts = signal<ClientProfile>({
    user_id: '',
    display_name: '',
    phone: '',
    telegram: '',
  });

  public readonly contactsSaving = signal(false);

  public readonly contactsExpanded = signal(false);

  // ngModel-friendly доступ
  public get displayName(): string { return this.contacts().display_name; }
  public set displayName(v: string) { this.contacts.set({ ...this.contacts(), display_name: v }); }
  public get phone(): string { return this.contacts().phone; }
  public set phone(v: string) { this.contacts.set({ ...this.contacts(), phone: v }); }
  public get telegram(): string { return this.contacts().telegram; }
  public set telegram(v: string) { this.contacts.set({ ...this.contacts(), telegram: v }); }

  public toggleContacts(): void {
    this.contactsExpanded.set(!this.contactsExpanded());
  }

  public saveContacts(): void {
    this.contactsSaving.set(true);
    const c = this.contacts();
    this.profileApi.patch({
      display_name: c.display_name,
      phone: c.phone,
      telegram: c.telegram,
    }).subscribe({
      next: (cp) => {
        this.contacts.set(cp);
        this.contactsSaving.set(false);
        this.msg.success('Контакты сохранены');
      },
      error: () => {
        this.contactsSaving.set(false);
        this.msg.error('Не удалось сохранить');
      },
    });
  }

  public label(s: ProjectClientView['display_status']): string {
    return PROJECT_STATUS_LABEL[s];
  }

  public color(s: ProjectClientView['display_status']): string {
    return PROJECT_STATUS_COLOR[s];
  }

  public constructor() {
    this.api.listClientProjects().subscribe({
      next: (resp) => {
        this.projects.set(resp.items);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
    this.profileApi.get().subscribe({
      next: (cp) => {
        this.contacts.set(cp);
        // если ничего не заполнено — раскроем блок, чтобы клиент сразу видел
        if (!cp.display_name && !cp.phone && !cp.telegram) {
          this.contactsExpanded.set(true);
        }
      },
    });
  }

  public open(p: ProjectClientView): void {
    void this.router.navigate(['/me/projects', p.id]);
  }

  public logout(): void {
    this.auth.clear();
    void this.router.navigateByUrl('/');
  }
}
