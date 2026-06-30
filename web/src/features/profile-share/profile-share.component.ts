import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { NzInputModule } from 'ng-zorro-antd/input';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { NzMessageService } from 'ng-zorro-antd/message';
import * as QRCode from 'qrcode';

@Component({
  selector: 'app-profile-share',
  standalone: true,
  imports: [CommonModule, FormsModule, NzInputModule, NzButtonModule, NzIconModule],
  templateUrl: './profile-share.component.html',
  styleUrl: './profile-share.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProfileShareComponent implements AfterViewInit {
  public readonly username = input<string>('');
  public readonly userId = input.required<string>();
  public readonly displayName = input<string>('');

  public readonly usernameChange = output<string>();

  public readonly draft = signal('');
  public readonly saving = signal(false);
  public readonly editError = signal('');
  public readonly editing = signal(false);

  // QR показывается в fullscreen-модалке — как в Telegram. На мобиле так
  // удобнее: можно увеличить экран и дать клиенту сосканировать без рывков.
  public readonly showQR = signal(false);

  public readonly qrCanvas = viewChild<ElementRef<HTMLCanvasElement>>('qrCanvas');
  public readonly handleInput = viewChild<ElementRef<HTMLInputElement>>('handleInput');

  private readonly msg = inject(NzMessageService);

  public readonly host = computed(() =>
    typeof window !== 'undefined' ? window.location.host : '',
  );

  public readonly shareURL = computed(() => {
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    const handle = this.username().trim() || this.userId();
    return `${origin}/specialist/${handle}`;
  });

  public readonly canNativeShare = signal(false);

  public readonly usernameHint = 'a–z, цифры, _ и - (3–30 символов)';

  constructor() {
    if (typeof navigator !== 'undefined' && 'share' in navigator) {
      this.canNativeShare.set(true);
    }
    // QR-канвас существует только когда showQR=true → effect ждёт его
    // появления и рисует. Реактивно перерисует при смене URL.
    effect(() => {
      const url = this.shareURL();
      if (!this.showQR()) return;
      // Канвас рендерится после @if (showQR()) — даём ангуляру тик.
      queueMicrotask(() => {
        const canvas = this.qrCanvas()?.nativeElement;
        if (!canvas) return;
        QRCode.toCanvas(canvas, url, {
          width: 280,
          margin: 1,
          color: { dark: '#000000', light: '#ffffff' },
        }).catch(() => {});
      });
    });
  }

  public ngAfterViewInit(): void {
    // ESC закрывает QR. Bind one-time.
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.showQR()) this.showQR.set(false);
    });
  }

  public startEdit(): void {
    this.draft.set(this.username());
    this.editError.set('');
    this.editing.set(true);
    // Автофокус инпута чтобы юзер сразу мог печатать.
    queueMicrotask(() => this.handleInput()?.nativeElement.focus());
  }

  public cancelEdit(): void {
    this.editing.set(false);
    this.editError.set('');
  }

  public saveUsername(): void {
    const v = this.draft().trim().toLowerCase();
    if (v !== '' && !/^[a-z0-9_-]{3,30}$/.test(v)) {
      this.editError.set('Только латиница, цифры, _ и -, 3–30 символов.');
      return;
    }
    this.saving.set(true);
    this.editError.set('');
    this.usernameChange.emit(v);
  }

  public onSaveSuccess(): void {
    this.saving.set(false);
    this.editing.set(false);
  }

  public onSaveError(message: string): void {
    this.saving.set(false);
    this.editError.set(message);
  }

  public copyURL(): void {
    const url = this.shareURL();
    // navigator.clipboard работает только в secure context (https://, localhost).
    // На http://192.168.x.x:4200 → DOMException. Fallback через legacy
    // execCommand('copy') на временный textarea — работает в любом контексте.
    if (this.copyToClipboard(url)) {
      this.msg.success('Ссылка скопирована');
    } else {
      this.msg.error('Не удалось скопировать — выделите ссылку вручную');
    }
  }

  private copyToClipboard(text: string): boolean {
    // 1) Современный API — только в secure context.
    if (typeof navigator !== 'undefined' && navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).catch(() => {});
      return true;
    }
    // 2) Legacy fallback — работает в http: localhost-сетях / IP-доменах
    // во время локальной разработки.
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      // Прячем визуально, но оставляем в дереве — иначе iOS Safari
      // не делает copy. position:fixed чтобы не скроллило viewport.
      ta.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0;';
      ta.setAttribute('readonly', '');
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      // execCommand deprecated, но `copy` ещё поддерживается во всех браузерах.
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch {
      return false;
    }
  }

  public nativeShare(): void {
    if (!this.canNativeShare()) {
      this.copyURL();
      return;
    }
    navigator
      .share({
        title: this.displayName() || 'Профиль на wayprmarket',
        text: 'Посмотри моё портфолио',
        url: this.shareURL(),
      })
      .catch(() => {});
  }

  public viewAsClient(): void {
    window.open(this.shareURL(), '_blank', 'noopener');
  }

  public closeQR(ev: MouseEvent): void {
    if (ev.target === ev.currentTarget) this.showQR.set(false);
  }
}
