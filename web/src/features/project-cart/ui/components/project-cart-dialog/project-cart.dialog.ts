import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { Router } from '@angular/router';
import { NzModalRef, NzModalService } from 'ng-zorro-antd/modal';
import { SpecialistLite } from '@entities/specialist/model/specialist.types';
import { formatRate } from '@shared/lib/format';
import { computeCartTotal } from '../../../lib/cart-total';
import { ProjectCartStore } from '../../../model/project-cart.store';
import { LeadSubmitDialogComponent } from '../lead-submit/lead-submit.dialog';

@Component({
  selector: 'app-project-cart-dialog',
  standalone: true,
  templateUrl: './project-cart.dialog.html',
  styleUrl: '../../project-dialog.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProjectCartDialogComponent {
  private readonly cart = inject(ProjectCartStore);

  private readonly cartModal = inject(NzModalRef);

  private readonly modal = inject(NzModalService);

  private readonly router = inject(Router);

  public readonly specialists = this.cart.specialists;

  public readonly total = computed(() => computeCartTotal(this.specialists()));

  public readonly formatRate = formatRate;

  public remove(userId: string, ev: Event): void {
    ev.stopPropagation();
    this.cart.remove(userId);
  }

  public clear(): void {
    this.cart.clear();
  }

  public close(): void {
    this.cartModal.destroy();
  }

  public checkout(): void {
    if (!this.specialists().length) return;
    this.cartModal.destroy();
    this.modal.create({
      nzContent: LeadSubmitDialogComponent,
      nzFooter: null,
      nzWidth: 540,
      nzClassName: 'project-modal',
      nzCentered: true,
    });
  }

  public openProfile(spec: SpecialistLite): void {
    this.cartModal.destroy();
    void this.router.navigate(['/specialist', spec.user_id]);
  }
}
