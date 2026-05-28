import { CommonModule, DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, input } from '@angular/core';

@Component({
  selector: 'app-rate-stars',
  imports: [CommonModule, DecimalPipe],
  templateUrl: './rate-stars.component.html',
  styleUrl: './rate-stars.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RateStarsComponent {
  public readonly rating = input.required<number>();

  public readonly reviewsCount = input.required<number>();
}
