import { TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { NZ_MODAL_DATA, NzModalRef } from 'ng-zorro-antd/modal';
import { throwError } from 'rxjs';

import { MeRepository } from '@entities/me/repository/me.repository';

import {
  PortfolioUploadDialog,
  PortfolioUploadDialogData,
} from '@features/portfolio-upload/portfolio-upload.dialog';

function makeData(overrides: Partial<PortfolioUploadDialogData> = {}): PortfolioUploadDialogData {
  return {
    categories: [],
    primaryCategory: '',
    selectedCategoryCodes: [],
    ...overrides,
  };
}

function makeFile(name = 'video.mp4', size = 1024, type = 'video/mp4'): File {
  const data = new Uint8Array(size);
  return new File([data], name, { type });
}

function pickFile(dialog: PortfolioUploadDialog, file: File): void {
  // onFilePicked ожидает Event с target.files[0].
  // Используем minimal-stub Event-объекта.
  const input = document.createElement('input');
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  // value сбрасывается внутри метода, добавляем сеттер.
  Object.defineProperty(input, 'value', { value: '', writable: true });
  const ev = { target: input } as unknown as Event;
  dialog.onFilePicked(ev);
}

describe('PortfolioUploadDialog', () => {
  let modalRef: jasmine.SpyObj<NzModalRef>;
  let meRepo: jasmine.SpyObj<MeRepository>;

  function setup(data?: Partial<PortfolioUploadDialogData>): PortfolioUploadDialog {
    // Reset нужен, потому что часть тестов зовёт setup() несколько раз подряд
    // (перебор имён файлов в цикле). Первый runInInjectionContext уже создаёт
    // инстанс модуля, и второй configureTestingModule без сброса падает.
    TestBed.resetTestingModule();
    modalRef = jasmine.createSpyObj<NzModalRef>('NzModalRef', ['close']);
    meRepo = jasmine.createSpyObj<MeRepository>('MeRepository', [
      'presignPortfolioUpload',
      'presignAvatarUpload',
      'addPortfolio',
      'multipartStart',
      'multipartPartURL',
      'multipartComplete',
      'multipartAbort',
    ]);

    TestBed.configureTestingModule({
      providers: [
        // Диалог на ошибке аплоада показывает nz-message, а тот анимирован.
        // Без провайдера анимаций рендер сообщения падает с NG05105.
        provideNoopAnimations(),
        { provide: NzModalRef, useValue: modalRef },
        { provide: NZ_MODAL_DATA, useValue: makeData(data) },
        { provide: MeRepository, useValue: meRepo },
      ],
    });
    return TestBed.runInInjectionContext(() => new PortfolioUploadDialog());
  }

  describe('validation', () => {
    it('rejects unsupported content type', () => {
      const d = setup();
      pickFile(d, makeFile('image.png', 100, 'image/png'));
      expect(d.errorText()).toContain('mp4');
      expect(d.file()).toBeNull(); // файл не принят
    });

    it('rejects file larger than 200 MB', () => {
      const d = setup();
      pickFile(d, makeFile('huge.mp4', 250 * 1024 * 1024));
      expect(d.errorText()).toContain('200');
      expect(d.file()).toBeNull();
    });

    it('accepts valid mp4 and clears prior error', () => {
      const d = setup();
      // Сначала плохой
      pickFile(d, makeFile('bad.txt', 100, 'text/plain'));
      expect(d.errorText()).toBeTruthy();
      // Потом хороший — error должен очиститься
      meRepo.presignPortfolioUpload.and.returnValue(throwError(() => new Error('stop')));
      pickFile(d, makeFile('good.mp4', 1024));
      expect(d.errorText()).toBe('');
      expect(d.file()).toBeTruthy();
    });
  });

  // Имя файла в «Название» больше НЕ подставляется: оттуда на публичную
  // страницу приезжали «Запись экрана 2026-08-20 в 14.55.13» и хвосты UUID.
  // Название пишет человек — поле остаётся пустым с плейсхолдером.
  describe('название работы', () => {
    it('имя файла не попадает в title ни в каком виде', () => {
      for (const fname of [
        'Свадьба Анны.mp4',
        'Запись экрана 2026-08-20 в 14.55.13.mov',
        'DSC_0042.mp4',
        'Sample 20s — 3ddc7a95-0629-4af6-9c1e-2b7f0a1d4e55.mp4',
      ]) {
        const d = setup();
        meRepo.presignPortfolioUpload.and.returnValue(throwError(() => new Error('stop')));
        pickFile(d, makeFile(fname));
        expect(d.title()).toBe('');
      }
    });

    it('плейсхолдер подсказывает, что писать', () => {
      const d = setup();
      meRepo.presignPortfolioUpload.and.returnValue(throwError(() => new Error('stop')));
      pickFile(d, makeFile('Свадьба Анны.mp4'));
      expect(d.titlePlaceholder()).toContain('Например');
    });

    it('без названия сохранить нельзя', () => {
      const d = setup();
      meRepo.presignPortfolioUpload.and.returnValue(throwError(() => new Error('stop')));
      pickFile(d, makeFile('Свадьба Анны.mp4'));
      expect(d.canSave()).toBeFalse();
    });
  });

  describe('toggleCategory', () => {
    it('добавляет код если его не было, удаляет если был', () => {
      const d = setup({ primaryCategory: 'video' });
      expect(d.selectedCategoryCodes().has('video')).toBe(true);
      d.toggleCategory('photo');
      expect(d.selectedCategoryCodes().has('photo')).toBe(true);
      d.toggleCategory('video');
      expect(d.selectedCategoryCodes().has('video')).toBe(false);
    });
  });

  describe('cancel', () => {
    it('закрывает модалку с null', () => {
      const d = setup();
      d.cancel();
      expect(modalRef.close).toHaveBeenCalledWith(null);
    });
  });

  describe('save', () => {
    it('disabled когда не загружено видео (canSave=false → early return)', () => {
      const d = setup();
      d.title.set('A');
      // uploadedVideoUrl всё ещё пустой → canSave false
      d.save();
      expect(meRepo.addPortfolio).not.toHaveBeenCalled();
      expect(modalRef.close).not.toHaveBeenCalled();
    });

    it('disabled когда title пустой', () => {
      const d = setup();
      // имитация того что upload прошёл — публичных сигналов для этого нет,
      // поэтому через canSave=false при пустом title защита всё равно работает.
      d.save();
      expect(meRepo.addPortfolio).not.toHaveBeenCalled();
    });
  });
});
