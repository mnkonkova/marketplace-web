import { inject } from '@angular/core';
import { CanDeactivateFn } from '@angular/router';
import { NzModalService } from 'ng-zorro-antd/modal';

/** Компонент, который умеет сказать, есть ли в нём несохранённые правки. */
export interface HasUnsavedChanges {
  hasUnsavedChanges(): boolean;
}

/**
 * Спрашивает подтверждение, если уходят со страницы с грязной формой.
 *
 * Нужен там, где сохранение по кнопке, а не автосейв: в редакторе профиля
 * `/me` можно было заполнить половину анкеты, кликнуть в шапке «Лента» и
 * потерять всё без единого предупреждения.
 */
export const unsavedChangesGuard: CanDeactivateFn<HasUnsavedChanges> = (component) => {
  if (!component?.hasUnsavedChanges?.()) return true;
  const modal = inject(NzModalService);
  return new Promise<boolean>((resolve) => {
    modal.confirm({
      nzTitle: 'Уйти без сохранения?',
      nzContent: 'В профиле есть несохранённые изменения. Если уйти сейчас, они пропадут.',
      nzOkText: 'Уйти',
      nzOkDanger: true,
      nzCancelText: 'Остаться',
      nzOnOk: () => resolve(true),
      nzOnCancel: () => resolve(false),
    });
  });
};
