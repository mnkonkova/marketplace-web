import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { NzTableModule } from 'ng-zorro-antd/table';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzTagModule } from 'ng-zorro-antd/tag';
import { NzMessageService } from 'ng-zorro-antd/message';
import { NzPopconfirmModule } from 'ng-zorro-antd/popconfirm';

import { AdminApi, ManagerInfo } from '@entities/admin/api/admin.api';
import { AdminLayoutComponent } from '@widgets/admin-layout/admin-layout.component';

@Component({
  selector: 'app-admin-managers',
  standalone: true,
  imports: [
    CommonModule,
    NzTableModule,
    NzButtonModule,
    NzTagModule,
    NzPopconfirmModule,
    AdminLayoutComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './managers.page.html',
  styleUrl: './managers.page.scss',
})
export class AdminManagersPage implements OnInit {
  private readonly api = inject(AdminApi);

  private readonly msg = inject(NzMessageService);

  public readonly items = signal<ManagerInfo[]>([]);

  public ngOnInit(): void {
    this.fetch();
  }

  public approve(m: ManagerInfo): void {
    this.api.approveManager(m.user_id).subscribe({
      next: () => {
        this.msg.success('Аппрувлен');
        this.fetch();
      },
      error: () => this.msg.error('Не удалось'),
    });
  }

  public revoke(m: ManagerInfo): void {
    this.api.revokeManager(m.user_id).subscribe({
      next: () => {
        this.msg.success('Снят аппрув');
        this.fetch();
      },
      error: () => this.msg.error('Не удалось'),
    });
  }

  private fetch(): void {
    this.api.listManagers().subscribe((r) => this.items.set(r.items));
  }
}
