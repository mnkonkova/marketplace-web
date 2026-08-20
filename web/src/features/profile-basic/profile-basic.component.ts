import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { NzInputModule } from 'ng-zorro-antd/input';
import { NzSelectModule } from 'ng-zorro-antd/select';

import { ProfileForm } from '@entities/me/model/profile-form';
import { ProfileCheckResult } from '@entities/me/model/me.types';
import { Production } from '@entities/production/model/production.types';
import { RateValidation, validateRate } from '@shared/lib/rate-validation';
import { RichBioComponent } from '@shared/ui/rich-bio/rich-bio.component';

/**
 * Вкладка «Основное»: аватар, имя, город, работодатель, ставка, «о себе»
 * и AI-проверка bio.
 *
 * Компонент намеренно не владеет состоянием: `form` — тот же объект, что
 * лежит на странице `/me`, ngModel пишет прямо в него. Так переключение
 * вкладок (компонент разрушается и создаётся заново) не теряет введённое,
 * и не появляется второго стора рядом со страницей.
 */
@Component({
  selector: 'app-profile-basic',
  standalone: true,
  imports: [
    FormsModule,
    NzButtonModule,
    NzIconModule,
    NzInputModule,
    NzSelectModule,
    RichBioComponent,
  ],
  templateUrl: './profile-basic.component.html',
  styleUrl: './profile-basic.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProfileBasicComponent {
  public readonly form = input.required<ProfileForm>();

  /** Что рисовать в кружке аватара: свежий blob: или сохранённый URL. */
  public readonly avatarUrl = input<string | undefined>('');

  /**
   * Инициалы для плейсхолдера аватара. Раньше на месте фото был коллаж из
   * тегов навыков — он выглядел как сломанная вёрстка, а не как «фото нет».
   */
  public readonly initials = computed(() => {
    const name = (this.form().display_name ?? '').trim();
    if (!name) return '?';
    const words = name.split(/\s+/).filter(Boolean).slice(0, 2);
    return words.map((w) => w[0].toUpperCase()).join('');
  });

  public readonly avatarUploading = input(false);

  public readonly productions = input<Production[]>([]);

  /** '' — не выбрано, 'freelance' — фриланс, иначе UUID продакшена. */
  public readonly production = input<string>('');

  public readonly check = input<ProfileCheckResult | null>(null);

  public readonly checkLoading = input(false);

  public readonly avatarPicked = output<Event>();

  public readonly avatarCleared = output<void>();

  public readonly checkRequested = output<void>();

  public readonly productionChange = output<string>();

  /** Мини-превью «как отрендерится на публичной» — по кнопке, не всегда. */
  public readonly bioPreview = signal(false);

  /**
   * Короткий алиас для шаблона: `[(ngModel)]="f.city"`. Через `form().city`
   * тоже собралось бы, но геттер читается лучше и не зовёт сигнал по разу
   * на каждое поле.
   */
  public get f(): ProfileForm {
    return this.form();
  }

  public get productionValue(): string {
    return this.production();
  }

  public set productionValue(v: string) {
    this.productionChange.emit(v);
  }

  /**
   * Метод, а не computed: `form` — обычный мутируемый объект под ngModel,
   * сигналы за его полями не следят. Переоценивается на каждом CD-цикле
   * компонента, то есть после любого ввода в поля ставки.
   */
  public rate(): RateValidation {
    const f = this.form();
    return validateRate(f.rate_min, f.rate_max, f.currency);
  }

  public bioLength(): number {
    return (this.form().bio ?? '').trim().length;
  }
}
