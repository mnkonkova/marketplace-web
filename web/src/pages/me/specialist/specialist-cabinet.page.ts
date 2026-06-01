import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { NzSpinModule } from 'ng-zorro-antd/spin';
import { NzSelectModule } from 'ng-zorro-antd/select';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzCardModule } from 'ng-zorro-antd/card';
import { NzTagModule } from 'ng-zorro-antd/tag';
import { NzProgressModule } from 'ng-zorro-antd/progress';
import { NzMessageService } from 'ng-zorro-antd/message';
import { NzEmptyModule } from 'ng-zorro-antd/empty';

import { API_URL } from '@shared/api/api-url.token';
import { MeProfile } from '@entities/me/model/me.types';
import { ProductionApi } from '@entities/production/api/production.api';
import { Production } from '@entities/production/model/production.types';
import { ProjectApi } from '@entities/project/api/project.api';
import { ProjectManagerView } from '@entities/project/model/project.types';
import { PROJECT_STATUS_COLOR, PROJECT_STATUS_LABEL } from '@shared/lib/project-status';
import { AppHeaderComponent } from '@widgets/app-header/app-header.component';

@Component({
  selector: 'app-specialist-cabinet',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    NzSpinModule,
    NzSelectModule,
    NzButtonModule,
    NzCardModule,
    NzTagModule,
    NzProgressModule,
    NzEmptyModule,
    AppHeaderComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './specialist-cabinet.page.html',
  styleUrl: './specialist-cabinet.page.scss',
})
export class SpecialistCabinetPage implements OnInit {
  private readonly http = inject(HttpClient);

  private readonly api = inject(API_URL);

  private readonly productionApi = inject(ProductionApi);

  private readonly projectApi = inject(ProjectApi);

  private readonly msg = inject(NzMessageService);

  public readonly loading = signal(true);

  public readonly saving = signal(false);

  public readonly profile = signal<MeProfile | null>(null);

  public readonly productions = signal<Production[]>([]);

  // 'freelance' — фриланс; UUID — конкретный продакшен; '' — не выбрано.
  public readonly selected = signal<string>('');

  // ngModel-friendly getter/setter для двусторонней привязки nz-select.
  public get selectedValue(): string {
    return this.selected();
  }

  public set selectedValue(v: string) {
    this.selected.set(v);
  }

  public readonly projects = signal<ProjectManagerView[]>([]);

  public ngOnInit(): void {
    this.http.get<MeProfile>(`${this.api}/me/profile`).subscribe({
      next: (p) => {
        this.profile.set(p);
        this.selected.set(p.is_freelance ? 'freelance' : (p.production_id ?? ''));
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
    this.productionApi.listActive().subscribe((r) => this.productions.set(r.items));
    this.projectApi
      .managerInbox() // плейсхолдер — заменено ниже
      .subscribe();
    this.http
      .get<{ items: ProjectManagerView[] }>(`${this.api}/me/specialist/projects`)
      .subscribe({
        next: (r) => this.projects.set(r.items),
      });
  }

  public projectStatusLabel(s: ProjectManagerView['display_status']): string {
    return PROJECT_STATUS_LABEL[s];
  }

  public projectStatusColor(s: ProjectManagerView['display_status']): string {
    return PROJECT_STATUS_COLOR[s];
  }

  public save(): void {
    const value = this.selected();
    const p = this.profile();
    if (!p) return;
    this.saving.set(true);
    const body: { production_id?: string; is_freelance?: boolean; updated_at: string } = {
      updated_at: p.updated_at,
    };
    if (value === 'freelance') {
      body.is_freelance = true;
    } else if (value === '') {
      body.production_id = '';
      body.is_freelance = false;
    } else {
      body.production_id = value;
    }
    this.http.patch<MeProfile>(`${this.api}/me/profile`, body).subscribe({
      next: (np) => {
        this.profile.set(np);
        this.saving.set(false);
        this.msg.success('Сохранено');
      },
      error: () => {
        this.saving.set(false);
        this.msg.error('Не удалось сохранить');
      },
    });
  }
}
