import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { NzIconModule } from 'ng-zorro-antd/icon';

let seq = 0;

/**
 * Аватар: кликается вся плитка, в углу бейдж-камера, под ней «Удалить фото».
 * Общий для кабинета и мастера регистрации.
 *
 * Загрузку не выполняет — только отдаёт выбранный файл наружу: в кабинете и
 * в мастере она идёт через один и тот же MeRepository, но в разные моменты.
 */
@Component({
  selector: 'app-avatar-picker',
  standalone: true,
  imports: [NzIconModule],
  templateUrl: './avatar-picker.component.html',
  styleUrl: './avatar-picker.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AvatarPickerComponent {
  public readonly url = input<string | undefined>('');

  public readonly uploading = input(false);

  /** Имя для инициалов, когда фото ещё нет. */
  public readonly name = input('');

  public readonly hint = input('');

  public readonly picked = output<Event>();

  public readonly cleared = output<void>();

  /** На одной странице аватар может быть не один — id должен быть уникальным. */
  public readonly inputId = `avatarFileInput${++seq}`;

  public readonly initials = computed(() => {
    const name = (this.name() ?? '').trim();
    if (!name) return '?';
    return name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0].toUpperCase())
      .join('');
  });
}
