import { SOCIAL_NETWORKS, SocialKey } from '@shared/lib/social-links';

/**
 * Form-state редактора профиля `/me`. Живёт отдельно от `MeProfile`, потому
 * что это черновик: пользователь печатает в него, а на сервер он уезжает
 * только по кнопке «Сохранить».
 *
 * Модель вынесена из `pages/cabinet` в entities, чтобы вкладки редактора
 * (`features/profile-*`) могли её принимать и мутировать через ngModel, не
 * импортируя страницу (это был бы циклический импорт page → feature → page).
 */
export interface ProfileForm {
  display_name: string;
  bio: string;
  avatar_url?: string;
  city: string;
  rate_min: number | null;
  rate_max: number | null;
  currency: string;
  contact_email: string;
  contact_phone: string;
  social_links: Record<SocialKey, string>;
  updated_at?: string;
}

/**
 * Все 9 ключей соцсетей с пустыми значениями. Нужно, чтобы ngModel мог
 * писать через `form.social_links[key]` без undefined-проблем.
 */
export function emptySocialLinks(): Record<SocialKey, string> {
  return SOCIAL_NETWORKS.reduce(
    (acc, n) => {
      acc[n.key] = '';
      return acc;
    },
    {} as Record<SocialKey, string>,
  );
}

export function emptyProfileForm(): ProfileForm {
  return {
    display_name: '',
    bio: '',
    city: '',
    rate_min: null,
    rate_max: null,
    currency: 'RUB',
    contact_email: '',
    contact_phone: '',
    social_links: emptySocialLinks(),
  };
}
