import { ApplicationConfig, importProvidersFrom, provideZoneChangeDetection } from '@angular/core';
import {
  provideRouter,
  withComponentInputBinding,
  withInMemoryScrolling,
} from '@angular/router';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { registerLocaleData } from '@angular/common';
import ru from '@angular/common/locales/ru';
import { FormsModule } from '@angular/forms';
import { provideNzI18n, ru_RU } from 'ng-zorro-antd/i18n';
import { provideNzIcons } from 'ng-zorro-antd/icon';
import {
  AppstoreOutline,
  ArrowRightOutline,
  BankOutline,
  BranchesOutline,
  CalendarOutline,
  CheckOutline,
  CloseOutline,
  ContactsOutline,
  DashboardOutline,
  DeleteOutline,
  DollarOutline,
  DownOutline,
  EyeInvisibleOutline,
  EyeOutline,
  HeartOutline,
  InboxOutline,
  InfoCircleOutline,
  LoadingOutline,
  LogoutOutline,
  MenuOutline,
  MessageOutline,
  OrderedListOutline,
  PlusOutline,
  ProjectOutline,
  SearchOutline,
  TeamOutline,
} from '@ant-design/icons-angular/icons';

import { routes } from './app.routes';
import { authInterceptor } from '@shared/api/auth.interceptor';
import { NzModalModule } from 'ng-zorro-antd/modal';

registerLocaleData(ru);

// Все иконки регистрируем статически. NgZorro без provideNzIcons() тянет
// SVG с alicdn — оно нестабильно из РФ и шумит 404'ками в DevTools.
// Если добавляешь nzType="..." — добавь и сюда соответствующий *Outline.
const icons = [
  AppstoreOutline,
  ArrowRightOutline,
  BankOutline,
  BranchesOutline,
  CalendarOutline,
  CheckOutline,
  CloseOutline,
  ContactsOutline,
  DashboardOutline,
  DeleteOutline,
  DollarOutline,
  DownOutline,
  EyeInvisibleOutline,
  EyeOutline,
  HeartOutline,
  InboxOutline,
  InfoCircleOutline,
  LoadingOutline,
  LogoutOutline,
  MenuOutline,
  MessageOutline,
  OrderedListOutline,
  PlusOutline,
  ProjectOutline,
  SearchOutline,
  TeamOutline,
];

export const appConfig: ApplicationConfig = {
  providers: [
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideRouter(
      routes,
      withComponentInputBinding(),
      // По дефолту Angular router сохраняет scroll-позицию при навигации
      // вперёд — переход с главной (где юзер скроллил вниз) на /specialist
      // открывал страницу не сверху, теряя hero-карточку.
      // 'top' — новые навигации скроллят на 0, back/forward — восстанавливают
      // позицию (поведение браузера).
      withInMemoryScrolling({
        scrollPositionRestoration: 'top',
        anchorScrolling: 'enabled',
      }),
    ),
    provideHttpClient(withInterceptors([authInterceptor])),
    provideAnimationsAsync(),
    importProvidersFrom(NzModalModule),
    provideNzI18n(ru_RU),
    provideNzIcons(icons),
    importProvidersFrom(FormsModule),
  ],
};
