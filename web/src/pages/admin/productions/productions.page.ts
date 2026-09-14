import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { NzTableModule } from 'ng-zorro-antd/table';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzInputModule } from 'ng-zorro-antd/input';
import { NzCheckboxModule } from 'ng-zorro-antd/checkbox';
import { NzModalModule, NzModalService } from 'ng-zorro-antd/modal';
import { NzMessageService } from 'ng-zorro-antd/message';

import { ProductionApi } from '@entities/production/api/production.api';
import { Production } from '@entities/production/model/production.types';
import { parseApiError } from '@shared/api/api-error';
import { ListStateComponent } from '@shared/ui/list-state/list-state.component';
import { PageHeadComponent } from '@shared/ui/page-head/page-head.component';
import { RowMenuComponent, RowMenuItem } from '@shared/ui/row-menu/row-menu.component';
import { StatusTagComponent } from '@shared/ui/status-tag/status-tag.component';

@Component({
  selector: 'app-admin-productions',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    NzTableModule,
    NzButtonModule,
    NzInputModule,
    NzCheckboxModule,
    NzModalModule,
    ListStateComponent,
    PageHeadComponent,
    RowMenuComponent,
    StatusTagComponent,
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

  /**
   * Выключенные по умолчанию скрыты. Выключенный продакшен нельзя
   * назначить, а в общей куче он выглядит обычной строкой — и его
   * выбирают, пока не упрутся. Счётчик в сайдбаре считает так же.
   */
  public includeOff = false;

  public readonly visible = computed(() =>
    this.includeOff ? this.items() : this.items().filter((p) => p.is_active),
  );

  public readonly hiddenCount = computed(() => this.items().filter((p) => !p.is_active).length);

  public readonly loading = signal(true);

  public readonly error = signal<string | null>(null);

  public readonly editing = signal<Partial<Production>>({ name: '', description: '' });

  public ngOnInit(): void {
    this.fetch();
  }

  public menuFor(p: Production): RowMenuItem[] {
    return p.is_active
      ? [
          {
            code: 'off',
            label: 'Выключить',
            danger: true,
            confirm: `Выключить «${p.name}»? В профилях он останется, но выбрать его больше нельзя.`,
          },
        ]
      : [{ code: 'on', label: 'Включить обратно' }];
  }

  public onPick(p: Production, code: string): void {
    if (code === 'off') this.deactivate(p);
    if (code === 'on') this.activate(p);
  }

  public openCreate(tpl: unknown): void {
    this.editing.set({ name: '', description: '' });
    this.modal.create({
      nzTitle: 'Создать продакшен',
      nzContent: tpl as never,
      nzOkText: 'Создать',
      nzCancelText: 'Отмена',
      nzOnOk: () => {
        const e = this.editing();
        if (!e.name?.trim()) return false;
        this.api.create({ name: e.name, description: e.description ?? '' }).subscribe({
          next: () => {
            this.msg.success('Продакшен создан');
            this.fetch();
          },
          error: (err) => this.msg.error(parseApiError(err, 'Не удалось создать').message),
        });
        return true;
      },
    });
  }

  public deactivate(p: Production): void {
    this.api.delete(p.id).subscribe({
      next: () => {
        this.msg.success('Выключен');
        this.fetch();
      },
      error: (e) => this.msg.error(parseApiError(e, 'Не удалось').message),
    });
  }

  public activate(p: Production): void {
    this.api.patch(p.id, { is_active: true }).subscribe({
      next: () => {
        this.msg.success('Включён');
        this.fetch();
      },
      error: (e) => this.msg.error(parseApiError(e, 'Не удалось').message),
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

  public onToggleOff(): void {
    // Ручка отдаёт всё сразу — перечитывать список ради фильтра незачем.
    this.items.set([...this.items()]);
  }

  public fetch(): void {
    this.loading.set(true);
    this.error.set(null);
    this.api.listAll().subscribe({
      next: (r) => {
        this.items.set(r.items);
        this.loading.set(false);
      },
      error: (e) => {
        this.loading.set(false);
        this.error.set(parseApiError(e, 'Не удалось загрузить продакшены.').message);
      },
    });
  }
}
