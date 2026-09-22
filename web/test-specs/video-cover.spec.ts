import { videoCoverUrl, youtubeId } from '@entities/publication/lib/video-cover';

/**
 * Обложка ролика выводится из ссылки, а не приходит с сервера.
 *
 * Кадра у нас нет: ролик лежит на чужой площадке. У YouTube адрес превью
 * складывается из идентификатора видео — это настоящий кадр того самого
 * ролика, без ключей и запросов к API. У остальных площадок такого
 * правила нет, и выдумывать его нельзя: «обложка не загрузилась» читается
 * как поломка, а не как «у нас её нет».
 */
describe('обложка ролика по ссылке', () => {
  it('идентификатор берётся из всех форм адреса YouTube', () => {
    expect(youtubeId('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
    expect(youtubeId('https://youtu.be/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
    expect(youtubeId('https://www.youtube.com/shorts/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
    expect(youtubeId('https://m.youtube.com/embed/dQw4w9WgXcQ?start=3')).toBe('dQw4w9WgXcQ');
  });

  it('чужая площадка и мусор обложки не дают', () => {
    expect(youtubeId('https://www.tiktok.com/@creator/video/7300000000000000000')).toBeNull();
    expect(youtubeId('https://vk.com/clip-1_456239017')).toBeNull();
    expect(youtubeId('не ссылка')).toBeNull();
    expect(youtubeId('')).toBeNull();
  });

  it('короткий хвост не принимается за идентификатор', () => {
    // 11 символов — единственная форма id. Всё прочее дало бы 404 и
    // битую картинку на месте кадра.
    expect(youtubeId('https://youtu.be/abc')).toBeNull();
  });

  it('обложка берётся из первой подходящей ссылки выкладки', () => {
    expect(
      videoCoverUrl([
        'https://www.tiktok.com/@creator/video/7300000000000000000',
        'https://www.youtube.com/shorts/dQw4w9WgXcQ',
      ]),
    ).toBe('https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg');
  });

  it('без подходящих ссылок обложки нет — и это null, а не пустая строка', () => {
    expect(videoCoverUrl(['https://vk.com/clip-1_456239017'])).toBeNull();
    expect(videoCoverUrl([])).toBeNull();
    expect(videoCoverUrl(undefined)).toBeNull();
  });
});
