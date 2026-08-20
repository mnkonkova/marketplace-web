import { socialLinkURL } from '@shared/lib/social-links';

// Пользователи вводят кто как: с собакой, без, и просто копируют адрес из
// строки браузера. Раньше «t.me/user» приклеивался к нашему префиксу и
// получалось https://t.me/t.me/user.
describe('socialLinkURL', () => {
  it('telegram: с собакой, без и адресом', () => {
    expect(socialLinkURL('telegram', 'foxxmary')).toBe('https://t.me/foxxmary');
    expect(socialLinkURL('telegram', '@foxxmary')).toBe('https://t.me/foxxmary');
    expect(socialLinkURL('telegram', 't.me/foxxmary')).toBe('https://t.me/foxxmary');
    expect(socialLinkURL('telegram', 'www.t.me/foxxmary/')).toBe('https://t.me/foxxmary');
    expect(socialLinkURL('telegram', 'telegram.me/foxxmary')).toBe('https://t.me/foxxmary');
  });

  it('готовую ссылку не трогаем', () => {
    expect(socialLinkURL('telegram', 'https://t.me/foxxmary')).toBe('https://t.me/foxxmary');
  });

  it('vk / instagram / tiktok', () => {
    expect(socialLinkURL('vk', 'vk.com/id1')).toBe('https://vk.com/id1');
    expect(socialLinkURL('instagram', 'instagram.com/user/')).toBe('https://instagram.com/user');
    expect(socialLinkURL('tiktok', 'tiktok.com/@user')).toBe('https://tiktok.com/@user');
    expect(socialLinkURL('tiktok', 'user')).toBe('https://tiktok.com/@user');
  });

  it('youtube: канал с собакой и без', () => {
    expect(socialLinkURL('youtube', 'chan')).toBe('https://youtube.com/@chan');
    expect(socialLinkURL('youtube', 'youtube.com/@chan')).toBe('https://youtube.com/@chan');
  });

  it('whatsapp — только цифры', () => {
    expect(socialLinkURL('whatsapp', '+7 (999) 123-45-67')).toBe('https://wa.me/79991234567');
    expect(socialLinkURL('whatsapp', 'нет цифр')).toBeNull();
  });

  it('пустое и один хост без хвоста → null', () => {
    expect(socialLinkURL('telegram', '  ')).toBeNull();
    expect(socialLinkURL('telegram', 't.me/')).toBeNull();
  });
});
