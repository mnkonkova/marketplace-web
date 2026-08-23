import { NzModalService } from 'ng-zorro-antd/modal';

import { ClientRegisterDialog } from './client-register.dialog';

/**
 * Одна точка открытия окна заказчика — чтобы шапка, лендинг и гейты не
 * расходились в настройках модалки. На телефоне окно раскрывается почти на
 * весь экран: иначе кнопка отправки прячется за клавиатурой.
 */
export function openClientRegister(modal: NzModalService) {
  return modal.create<ClientRegisterDialog, unknown, boolean>({
    nzContent: ClientRegisterDialog,
    nzFooter: null,
    nzWidth: 'min(440px, 94vw)',
    nzCentered: true,
    nzClassName: 'client-register-modal',
  });
}
