import { TemplateRef, Type, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { NZ_DRAWER_DATA, NzDrawerRef, NzDrawerService } from 'ng-zorro-antd/drawer';
import { NZ_MODAL_DATA, NzModalRef, NzModalService } from 'ng-zorro-antd/modal';

import { prefersSheet } from './touch';

/**
 * Окно на широком экране — нижняя шторка на узком.
 *
 * Одно содержимое, два способа показать. Окно по центру на телефоне
 * открывается далеко от большого пальца, закрывается крестиком в углу и
 * не даёт пролистать длинную форму; шторка приезжает снизу, листается и
 * закрывается смахиванием. Наоборот — тоже плохо: шторка на большом
 * экране растягивается во всю ширину ради одного поля.
 *
 * Решает ширина, а не только устройство ввода (prefersSheet): узкое
 * окно настольного браузера тачем не считается, и окно на 520 px
 * открывалось в экране 390 px — с экранной клавиатурой оно ещё и
 * прыгало на каждом переходе между полями.
 *
 * Помощник, а не компонент: у диалогов уже есть своя разметка и своя
 * логика, и им нужно ровно одно — как их показать. Внутри диалога
 * парные panelData()/panelRef() дают данные и закрытие, не зная, где он
 * открыт.
 */
export interface PanelHost {
  modal: NzModalService;
  drawer: NzDrawerService;
}

export interface PanelOptions<D> {
  title: string;
  /**
   * Компонент или готовый шаблон. Шаблон — для окон в три строки, у
   * которых своего компонента нет и заводить его незачем; кнопки в
   * таком случае живут в самом шаблоне: у шторки подвала нет.
   */
  content: Type<object> | TemplateRef<unknown>;
  data?: D;
  /** Ширина окна на десктопе. На шторку не влияет. */
  width?: number;
  /** Высота шторки: 'auto' по содержимому или доля экрана, '88%'. */
  height?: string;
}

/** Открытая панель: закрытие снаружи и то, что вернул диалог. */
export interface PanelHandle {
  close(result?: unknown): void;
  afterClose: Observable<unknown>;
}

/**
 * Открыть панель и получить ручку. Нужна там, где закрывают снаружи —
 * из кнопки в самом шаблоне: у шторки нет подвала с «Отмена», и
 * закрывать её приходится тому, кто открывал.
 */
export function openPanelHandle<D extends object>(
  host: PanelHost,
  opts: PanelOptions<D>,
): PanelHandle {
  if (prefersSheet()) {
    // Приведение: у drawer'а тип nzData условный (D extends undefined),
    // и вывести его через наш параметр TypeScript не берётся. Значение
    // при этом ровно то, что передали, — поэтому as, а не any. Шаблон
    // drawer типизирует своим контекстом, до которого нам дела нет.
    const ref = host.drawer.create<object, D, unknown>({
      nzTitle: opts.title,
      nzContent: opts.content as Type<object>,
      nzData: opts.data as D extends undefined ? object : D,
      nzPlacement: 'bottom',
      nzHeight: opts.height ?? 'auto',
      nzBodyStyle: { padding: '0 16px 24px' },
    });
    return { close: (r?: unknown) => ref.close(r), afterClose: ref.afterClose };
  }
  const modal = host.modal.create({
    nzTitle: opts.title,
    nzContent: opts.content,
    nzData: opts.data,
    nzFooter: null,
    nzWidth: opts.width ?? 520,
  });
  return { close: (r?: unknown) => modal.destroy(r), afterClose: modal.afterClose };
}

/** Открыть панель и дождаться закрытия. Значение — то, что вернул диалог. */
export function openPanel<D extends object>(
  host: PanelHost,
  opts: PanelOptions<D>,
): Observable<unknown> {
  return openPanelHandle(host, opts).afterClose;
}

/**
 * Данные панели внутри диалога. Живой всегда ровно один токен — тот,
 * которым открыли.
 */
export function panelData<T>(): T {
  return inject<T>(NZ_MODAL_DATA, { optional: true }) ?? inject<T>(NZ_DRAWER_DATA);
}

/** Закрытие панели тем способом, которым её открыли. */
export function panelRef(): { close: (result?: unknown) => void } {
  const drawer = inject<NzDrawerRef<unknown>>(NzDrawerRef, { optional: true });
  const modal = inject(NzModalRef, { optional: true });
  return {
    close: (result?: unknown) => {
      if (drawer) drawer.close(result);
      else modal?.destroy(result);
    },
  };
}
