import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { NZ_MODAL_DATA, NzModalRef } from 'ng-zorro-antd/modal';
import { LeadSuccessModalData } from '@features/project-cart/model/lead.types';

@Component({
  selector: 'app-lead-success-dialog',
  standalone: true,
  templateUrl: './lead-success.dialog.html',
  styleUrl: '../../project-dialog.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LeadSuccessDialogComponent {
  public readonly data = inject<LeadSuccessModalData>(NZ_MODAL_DATA);

  public readonly modal = inject(NzModalRef);

  public close(): void {
    this.modal.destroy();
  }
}
