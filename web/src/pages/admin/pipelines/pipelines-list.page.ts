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
import { Router } from '@angular/router';
import { NzTableModule } from 'ng-zorro-antd/table';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzInputModule } from 'ng-zorro-antd/input';
import { NzInputNumberModule } from 'ng-zorro-antd/input-number';
import { NzCheckboxModule } from 'ng-zorro-antd/checkbox';
import { NzModalModule, NzModalService } from 'ng-zorro-antd/modal';
import { NzMessageService } from 'ng-zorro-antd/message';

import { PipelineApi } from '@entities/pipeline/api/pipeline.api';
import { Pipeline } from '@entities/pipeline/model/pipeline.types';
import { parseApiError } from '@shared/api/api-error';
import { ListStateComponent } from '@shared/ui/list-state/list-state.component';
import { PageHeadComponent } from '@shared/ui/page-head/page-head.component';
import { RowMenuComponent, RowMenuItem } from '@shared/ui/row-menu/row-menu.component';
import { StatusTagComponent } from '@shared/ui/status-tag/status-tag.component';

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
    NzCheckboxModule,
    NzModalModule,
    ListStateComponent,
    PageHeadComponent,
    RowMenuComponent,
    StatusTagComponent,
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

  /**
   * Выключенные по умолчанию скрыты, как и тестовые проекты.
   *
   * Выключенная воронка в общей куче сбивает: назначить её нельзя, а
   * выглядит она обычной строкой. Заодно число строк сходится со
   * счётчиком в сайдбаре — он считает только действующие.
   */
  public includeOff = false;

  public readonly visible = computed(() =>
    this.includeOff ? this.items() : this.items().filter((p) => p.is_active),
  );

  public readonly hiddenCount = computed(() => this.items().filter((p) => !p.is_active).length);

  public readonly loading = signal(true);

  public readonly error = signal<string | null>(null);

  public readonly draft = signal({ name: '', description: '', revisions_included: 2 });

  public ngOnInit(): void {
    this.fetch();
  }

  public open(p: Pipeline): void {
    void this.router.navigate(['/admin/pipelines', p.id]);
  }

  /** Версия пишется одинаково везде: `v1`, у действующей — «v1 · действует». */
  public versionLabel(p: Pipeline): string {
    return p.is_active ? `v${p.version} · действует` : `v${p.version}`;
  }

  public menuFor(p: Pipeline): RowMenuItem[] {
    const out: RowMenuItem[] = [{ code: 'open', label: 'Открыть редактор' }];
    if (!p.is_default && p.is_active) {
      out.push({
        code: 'default',
        label: 'Сделать воронкой по умолчанию',
        confirm: `Новые проекты продакшна будут создаваться по «${p.name}». Сделать?`,
        disabled: !!this.busyId(),
      });
    }
    return out;
  }

  public onPick(p: Pipeline, code: string): void {
    if (code === 'open') this.open(p);
    if (code === 'default') this.makeDefault(p);
  }

  // busyId — id pipeline, для которого сейчас в полёте makeDefault.
  // Защищает от двойного клика: пока запрос идёт, пункт недоступен.
  // Без неё двойной клик пускал две concurrent транзакции, которые в
  // некоторых случаях оставляли is_default=false у обеих.
  public readonly busyId = signal<string | null>(null);

  public makeDefault(p: Pipeline): void {
    if (this.busyId()) return;
    this.busyId.set(p.id);
    this.api.makeDefault(p.id).subscribe({
      next: () => {
        this.busyId.set(null);
        this.msg.success(`«${p.name}» — теперь воронка по умолчанию`);
        this.fetch();
      },
      error: (e) => {
        this.busyId.set(null);
        this.msg.error(parseApiError(e, 'Не удалось').message);
      },
    });
  }

  public openCreate(tpl: unknown): void {
    this.draft.set({ name: '', description: '', revisions_included: 2 });
    this.modal.create({
      nzTitle: 'Создать воронку',
      nzContent: tpl as never,
      nzOkText: 'Создать',
      nzCancelText: 'Отмена',
      nzOnOk: () => {
        const d = this.draft();
        if (!d.name.trim()) return false;
        this.api.create(d).subscribe({
          next: (p) => {
            this.msg.success('Воронка создана');
            this.fetch();
            void this.router.navigate(['/admin/pipelines', p.id]);
          },
          error: (e) => this.msg.error(parseApiError(e, 'Не удалось создать').message),
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

  public onToggleOff(): void {
    // Значение уже в поле — перечитывать список незачем: ручка отдаёт всё
    // сразу, и фильтр здесь клиентский по той же причине.
    this.items.set([...this.items()]);
  }

  public fetch(): void {
    this.loading.set(true);
    this.error.set(null);
    this.api.list().subscribe({
      next: (r) => {
        this.items.set(r.items);
        this.loading.set(false);
      },
      error: (e) => {
        this.loading.set(false);
        this.error.set(parseApiError(e, 'Не удалось загрузить воронки.').message);
      },
    });
  }
}
