import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  effect,
  inject,
  input,
  signal,
  viewChild,
} from '@angular/core';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { NzMessageService } from 'ng-zorro-antd/message';
import * as QRCode from 'qrcode';
import { copyToClipboard } from '@shared/lib/clipboard';

/**
 * Ссылка-визитка на публичной странице: «Поделиться», QR и предпросмотр
 * того, как ссылка развернётся в мессенджере.
 *
 * Отдельный компонент от features/profile-share: тот принадлежит кабинету и
 * умеет редактировать handle — на публичной странице это чужое и лишнее.
 * Общее (копирование в буфер) вынесено в shared/lib/clipboard.
 */
@Component({
  selector: 'app-share-card',
  standalone: true,
  imports: [NzButtonModule, NzIconModule],
  templateUrl: './share-card.component.html',
  styleUrl: './share-card.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ShareCardComponent {
  public readonly url = input.required<string>();

  public readonly displayName = input<string>('');

  /** Главные роли — попадают в подпись предпросмотра и в native share. */
  public readonly roles = input<string>('');

  public readonly worksCount = input<number>(0);

  /** Обложка предпросмотра — постер флагмана или аватар. */
  public readonly coverUrl = input<string>('');

  private readonly msg = inject(NzMessageService);

  public readonly showQR = signal(false);

  public readonly qrCanvas = viewChild<ElementRef<HTMLCanvasElement>>('qrCanvas');

  public readonly canNativeShare = signal(typeof navigator !== 'undefined' && 'share' in navigator);

  /** Домен без протокола — так же, как его покажет мессенджер. */
  public readonly host = computed(() => {
    try {
      return new URL(this.url()).host;
    } catch {
      return '';
    }
  });

  public readonly unfurlTitle = computed(() => {
    const roles = this.roles();
    const name = this.displayName();
    return roles ? `${name} — ${roles}` : name;
  });

  public readonly unfurlSubtitle = computed(() => {
    const parts = [this.host(), 'портфолио'];
    const n = this.worksCount();
    if (n > 0) parts.push(`${n} ${pluralWorks(n)}`);
    return parts.join(' · ');
  });

  constructor() {
    // Канвас появляется только при showQR=true — ждём его и рисуем.
    effect(() => {
      const url = this.url();
      if (!this.showQR()) return;
      queueMicrotask(() => {
        const canvas = this.qrCanvas()?.nativeElement;
        if (!canvas) return;
        QRCode.toCanvas(canvas, url, {
          width: 240,
          margin: 1,
          color: { dark: '#000000', light: '#ffffff' },
        }).catch(() => {});
      });
    });
  }

  public toggleQR(): void {
    this.showQR.update((v) => !v);
  }

  public share(): void {
    if (this.canNativeShare()) {
      navigator
        .share({
          title: this.unfurlTitle(),
          text: 'Портфолио на wayprmarket',
          url: this.url(),
        })
        .catch(() => {});
      return;
    }
    if (copyToClipboard(this.url())) {
      this.msg.success('Ссылка скопирована');
    } else {
      this.msg.error('Не удалось скопировать — выделите ссылку вручную');
    }
  }
}

function pluralWorks(n: number): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return 'работа';
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return 'работы';
  return 'работ';
}
