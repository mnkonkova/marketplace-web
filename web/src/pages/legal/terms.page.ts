import { ChangeDetectionStrategy, Component } from '@angular/core';
import { AppHeaderComponent } from '@widgets/app-header/app-header.component';
import { SupportFooterComponent } from '@widgets/support-footer/support-footer.component';

@Component({
  selector: 'app-terms-page',
  standalone: true,
  imports: [AppHeaderComponent, SupportFooterComponent],
  templateUrl: './terms.page.html',
  styleUrl: './legal.page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TermsPage {}
