import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { NzTableModule } from 'ng-zorro-antd/table';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzInputModule } from 'ng-zorro-antd/input';
import { NzInputNumberModule } from 'ng-zorro-antd/input-number';
import { NzModalModule, NzModalService } from 'ng-zorro-antd/modal';
import { NzMessageService } from 'ng-zorro-antd/message';
import { NzTagModule } from 'ng-zorro-antd/tag';

import { PipelineApi } from '@entities/pipeline/api/pipeline.api';
import { Pipeline } from '@entities/pipeline/model/pipeline.types';
import { AdminLayoutComponent } from '@widgets/admin-layout/admin-layout.component';

@Component({
  selector: 'app-admin-pipelines-list',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    NzTableModule,
    NzButtonModule,
    NzInputModule,
    NzInputNumberModule,
    NzModalModule,
    NzTagModule,
    AdminLayoutComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './pipelines-list.page.html',
  styleUrl: './pipelines-list.page.scss',
})
export class AdminPipelinesListPage implements OnInit {
  private readonly api = inject(PipelineApi);

  private readonly router = inject(Router);

  private readonly modal = inject(NzModalService);

  private readonly msg = inject(NzMessageService);

  public readonly items = signal<Pipeline[]>([]);

  public readonly draft = signal({ name: '', description: '', revisions_included: 2 });

  public ngOnInit(): void {
    this.fetch();
  }

  public open(p: Pipeline): void {
    void this.router.navigate(['/admin/pipelines', p.id]);
  }

  // busyId — id pipeline, для которого сейчас в полёте makeDefault.
  // Защищает от двойного клика: пока запрос идёт, кнопка скрыта.
  // Без неё двойной клик пускал две concurrent транзакции, которые в
  // некоторых случаях оставляли is_default=false у обеих.
  public readonly busyId = signal<string | null>(null);

  public makeDefault(p: Pipeline): void {
    if (this.busyId()) return;
    this.busyId.set(p.id);
    this.api.makeDefault(p.id).subscribe({
      next: () => {
        this.busyId.set(null);
        this.msg.success(`«${p.name}» — теперь default`);
        this.fetch();
      },
      error: () => {
        this.busyId.set(null);
        this.msg.error('Не удалось');
      },
    });
  }

  public openCreate(tpl: unknown): void {
    this.draft.set({ name: '', description: '', revisions_included: 2 });
    this.modal.create({
      nzTitle: 'Новая воронка',
      nzContent: tpl as never,
      nzOnOk: () => {
        const d = this.draft();
        if (!d.name.trim()) return false;
        this.api.create(d).subscribe({
          next: (p) => {
            this.msg.success('Создана');
            this.fetch();
            void this.router.navigate(['/admin/pipelines', p.id]);
          },
          error: () => this.msg.error('Не удалось'),
        });
        return true;
      },
    });
  }

  public get name(): string {
    return this.draft().name;
  }

  public set name(v: string) {
    this.draft.set({ ...this.draft(), name: v });
  }

  public get description(): string {
    return this.draft().description;
  }

  public set description(v: string) {
    this.draft.set({ ...this.draft(), description: v });
  }

  public get revisions(): number {
    return this.draft().revisions_included;
  }

  public set revisions(v: number) {
    this.draft.set({ ...this.draft(), revisions_included: v });
  }

  private fetch(): void {
    this.api.list().subscribe((r) => this.items.set(r.items));
  }
}
