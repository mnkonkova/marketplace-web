/**
 * Опциональный прокси (если в environment apiBaseUrl = '/api/v1').
 * marketplace-api по умолчанию на :8080.
 *
 * Порт вынесен в переменную окружения: здесь стояло 8082, при том что
 * `make run` в бэкенде поднимает 8080. Расхождение молчаливое — фронт
 * просто получал 500 на каждый запрос к /api, и это выглядело как
 * поломка бэкенда, а не как несовпадение портов.
 */
const target = process.env.API_PROXY_TARGET || 'http://127.0.0.1:8080';

module.exports = {
  '/api': {
    target,
    secure: false,
    changeOrigin: true,
    logLevel: 'debug',
  },
};
