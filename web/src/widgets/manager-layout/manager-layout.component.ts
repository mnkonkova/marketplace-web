import { ChangeDetectionStrategy, Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { NzIconModule } from 'ng-zorro-antd/icon';

import { AppHeaderComponent } from '@widgets/app-header/app-header.component';

// Минимальный layout менеджерского кабинета: общая шапка сайта +
// боковая навигация по разделам (inbox / board / детальная страница
// открывается из карточек напрямую, без отдельного пункта).
@Component({
  selector: 'app-manager-layout',
  standalone: true,
  imports: [CommonModule, RouterLink, RouterLinkActive, NzIconModule, AppHeaderComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './manager-layout.component.html',
  styleUrl: './manager-layout.component.scss',
})
export class ManagerLayoutComponent {}
