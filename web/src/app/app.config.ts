import { ApplicationConfig, importProvidersFrom, provideZoneChangeDetection } from '@angular/core';
import { provideRouter, withComponentInputBinding } from '@angular/router';
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
  CalendarOutline,
  CloseOutline,
  DeleteOutline,
  EyeInvisibleOutline,
  EyeOutline,
  HeartOutline,
  MenuOutline,
  MessageOutline,
  ProjectOutline,
  SearchOutline,
  TeamOutline,
} from '@ant-design/icons-angular/icons';

import { routes } from './app.routes';
import { authInterceptor } from '@shared/api/auth.interceptor';
import { NzModalModule } from 'ng-zorro-antd/modal';

registerLocaleData(ru);

const icons = [
  SearchOutline,
  ArrowRightOutline,
  AppstoreOutline,
  ProjectOutline,
  TeamOutline,
  HeartOutline,
  MessageOutline,
  EyeInvisibleOutline,
  EyeOutline,
  CalendarOutline,
  CloseOutline,
  DeleteOutline,
  MenuOutline,
];

export const appConfig: ApplicationConfig = {
  providers: [
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideRouter(routes, withComponentInputBinding()),
    provideHttpClient(withInterceptors([authInterceptor])),
    provideAnimationsAsync(),
    importProvidersFrom(NzModalModule),
    provideNzI18n(ru_RU),
    provideNzIcons(icons),
    importProvidersFrom(FormsModule),
  ],
};
