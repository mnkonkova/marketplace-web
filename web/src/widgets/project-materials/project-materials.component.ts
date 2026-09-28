import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzInputModule } from 'ng-zorro-antd/input';
import { NzMessageService } from 'ng-zorro-antd/message';
import { NzModalService } from 'ng-zorro-antd/modal';

import { PublicationApi } from '@entities/publication/api/publication.api';
import {
  Material,
  MaterialAudience,
  MaterialKind,
} from '@entities/publication/model/publication.types';
import {
  MATERIAL_AUDIENCE_LABEL,
  MATERIAL_AUDIENCE_NOTE,
  MATERIAL_KIND_LABEL,
  materialsFor,
  sortMaterials,
  visibleTo,
} from '@entities/publication/lib/materials';
import { parseApiError } from '@shared/api/api-error';
import { withScheme } from '@shared/lib/url';
import { SheetComponent } from '@shared/ui/sheet/sheet.component';
import { isTouchDevice } from '@shared/lib/touch';

export type MaterialsRole = 'client' | 'creator' | 'manager';

// Материалы проекта: бренд-гайд, обучение, ссылки. У материала две
// аудитории, и это право доступа, а не сортировка: креаторские заказчику
// не отдаёт и сам бэк, а мы не показываем их вторым фильтром — цена
// ошибки здесь выше цены лишней строки кода.
@Component({
  selector: 'app-project-materials',
  standalone: true,
  imports: [CommonModule, FormsModule, NzButtonModule, NzInputModule, SheetComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './project-materials.component.html',
  styleUrl: './project-materials.component.scss',
})
export class ProjectMaterialsComponent {
  /**
   * На тач-экране форма добавления открывается нижним листом: внутри
   * длинной страницы она оказывалась ниже экрана, и нажатие на
   * «Добавить материал» выглядело как «ничего не произошло».
   */
  public readonly touch = isTouchDevice();

  private readonly api = inject(PublicationApi);

  private readonly msg = inject(NzMessageService);

  private readonly modal = inject(NzModalService);

  public readonly projectId = input.required<string>();

  public readonly role = input.required<MaterialsRole>();

  public readonly kindLabel = MATERIAL_KIND_LABEL;

  public readonly audienceLabel = MATERIAL_AUDIENCE_LABEL;

  public readonly audienceNote = MATERIAL_AUDIENCE_NOTE;

  // Договор — первым: его прикладывают чаще прочего, и он единственный
  // вид, который дальше живёт отдельной жизнью — уходит в «Мои
  // документы» креатора и показывается там первым. База и API знают
  // его с самого начала (миграция 00071), а выбрать его в форме было
  // нельзя — договор приходилось класть «документом» и терять всё, что
  // отдельный вид даёт.
  public readonly kinds: readonly MaterialKind[] = ['contract', 'doc', 'video', 'link'];

  public readonly items = signal<Material[]>([]);

  public readonly loaded = signal(false);

  public readonly busy = signal(false);

  public constructor() {
    effect(() => {
      const id = this.projectId();
      const role = this.role();
      if (id) this.load(id, role);
    });
  }

  public readonly isManager = computed(() => this.role() === 'manager');

  // Что вправе видеть эта роль. Бэк уже отфильтровал, но менеджерский
  // ответ содержит обе аудитории, и раскладывать их всё равно нам.
  private readonly allowed = computed(() => sortMaterials(visibleTo(this.items(), this.role())));

  public readonly forCreators = computed(() => materialsFor(this.allowed(), 'creators'));

  public readonly forClient = computed(() => materialsFor(this.allowed(), 'client'));

  // У клиента и креатора группа одна — заголовок про аудиторию там лишний.
  public readonly single = computed(() =>
    this.role() === 'client' ? this.forClient() : this.forCreators(),
  );

  public readonly empty = computed(() => this.allowed().length === 0);

  public readonly singleNote = computed(() =>
    this.role() === 'client'
      ? 'Материалы, которые команда открыла вам по этому проекту.'
      : 'Открылись, когда вас добавили в проект.',
  );

  // ---- добавление (менеджер) ----

  public readonly adding = signal(false);

  public newTitle = '';

  public newUrl = '';

  public newKind: MaterialKind = 'doc';

  public newAudience: MaterialAudience = 'creators';

  /**
   * Открыть форму добавления.
   *
   * Аудиторию принимаем параметром: кнопка стоит и в пустой группе, и
   * промахнуться списком «кому видно» там особенно легко — материал для
   * креаторов, приложенный к заказчику, это утечка, а не опечатка.
   */
  public openAdd(audience: MaterialAudience = 'creators'): void {
    this.newTitle = '';
    this.newUrl = '';
    this.newKind = 'doc';
    this.newAudience = audience;
    this.adding.set(true);
  }

  public cancelAdd(): void {
    this.adding.set(false);
  }

  public add(): void {
    const title = this.newTitle.trim();
    const url = this.newUrl.trim();
    if (!title) {
      this.msg.error('Название обязательно — по нему материал ищут глазами.');
      return;
    }
    // Схему дописываем сами. Адрес копируют из строки браузера, а она
    // давно показывает «vk.com/...» без «https://», и отказ на таком
    // адресе — требование к человеку сделать то, что машина делает
    // сама. Отказываем только когда это и не ссылка вовсе.
    const link = withScheme(url);
    if (!link) {
      this.msg.error(
        'Это не похоже на ссылку — нужен адрес вида vk.com/... или https://vk.com/...',
      );
      return;
    }
    this.busy.set(true);
    this.api
      .managerAddMaterial(this.projectId(), {
        title,
        url: link,
        kind: this.newKind,
        audience: this.newAudience,
      })
      .subscribe({
        next: (saved) => {
          this.busy.set(false);
          this.adding.set(false);
          this.items.set([...this.items(), saved]);
          this.msg.success(
            saved.audience === 'client'
              ? 'Материал добавлен — его видит заказчик.'
              : 'Материал добавлен — он открылся креаторам проекта.',
          );
        },
        error: (e) => {
          this.busy.set(false);
          this.msg.error(parseApiError(e, 'Не удалось добавить материал.').message);
        },
      });
  }

  public remove(m: Material): void {
    this.modal.confirm({
      nzTitle: `Убрать «${m.title}» из проекта?`,
      nzContent: 'Ссылка перестанет открываться у всех, кому материал был виден.',
      nzOkDanger: true,
      nzOnOk: () =>
        this.api.managerRemoveMaterial(this.projectId(), m.id).subscribe({
          next: () => {
            this.items.set(this.items().filter((x) => x.id !== m.id));
            this.msg.success('Материал убран');
          },
          error: (e) => this.msg.error(parseApiError(e, 'Не удалось убрать материал.').message),
        }),
    });
  }

  private load(id: string, role: MaterialsRole): void {
    const req =
      role === 'client'
        ? this.api.clientMaterials(id)
        : role === 'creator'
          ? this.api.creatorMaterials(id)
          : this.api.managerMaterials(id);
    req.subscribe({
      next: (r) => {
        this.items.set(r.items);
        this.loaded.set(true);
      },
      // Проект не про выкладки — материалов у него не бывает, и блок
      // просто не появится.
      error: () => {
        this.items.set([]);
        this.loaded.set(true);
      },
    });
  }
}
