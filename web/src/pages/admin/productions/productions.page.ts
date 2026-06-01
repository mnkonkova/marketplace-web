import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { NzTableModule } from 'ng-zorro-antd/table';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzInputModule } from 'ng-zorro-antd/input';
import { NzModalModule, NzModalService } from 'ng-zorro-antd/modal';
import { NzMessageService } from 'ng-zorro-antd/message';
import { NzTagModule } from 'ng-zorro-antd/tag';
import { NzPopconfirmModule } from 'ng-zorro-antd/popconfirm';

import { ProductionApi } from '@entities/production/api/production.api';
import { Production } from '@entities/production/model/production.types';
import { AdminLayoutComponent } from '@widgets/admin-layout/admin-layout.component';

@Component({
  selector: 'app-admin-productions',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    NzTableModule,
    NzButtonModule,
    NzInputModule,
    NzModalModule,
    NzTagModule,
    NzPopconfirmModule,
    AdminLayoutComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './productions.page.html',
  styleUrl: './productions.page.scss',
})
export class AdminProductionsPage implements OnInit {
  private readonly api = inject(ProductionApi);

  private readonly modal = inject(NzModalService);

  private readonly msg = inject(NzMessageService);

  public readonly items = signal<Production[]>([]);

  public readonly editing = signal<Partial<Production>>({ name: '', description: '' });

  public ngOnInit(): void {
    this.fetch();
  }

  public openCreate(tpl: unknown): void {
    this.editing.set({ name: '', description: '' });
    this.modal.create({
      nzTitle: 'Новый продакшен',
      nzContent: tpl as never,
      nzOnOk: () => {
        const e = this.editing();
        if (!e.name?.trim()) return false;
        this.api
          .create({ name: e.name, description: e.description ?? '' })
          .subscribe({
            next: () => {
              this.msg.success('Создан');
              this.fetch();
            },
            error: () => this.msg.error('Не удалось создать'),
          });
        return true;
      },
    });
  }

  public deactivate(p: Production): void {
    this.api.delete(p.id).subscribe({
      next: () => {
        this.msg.success('Деактивирован');
        this.fetch();
      },
      error: () => this.msg.error('Не удалось'),
    });
  }

  public activate(p: Production): void {
    this.api.patch(p.id, { is_active: true }).subscribe({
      next: () => {
        this.msg.success('Активирован');
        this.fetch();
      },
      error: () => this.msg.error('Не удалось'),
    });
  }

  public get name(): string {
    return this.editing().name ?? '';
  }

  public set name(v: string) {
    this.editing.set({ ...this.editing(), name: v });
  }

  public get description(): string {
    return this.editing().description ?? '';
  }

  public set description(v: string) {
    this.editing.set({ ...this.editing(), description: v });
  }

  private fetch(): void {
    this.api.listAll().subscribe((r) => this.items.set(r.items));
  }
}
