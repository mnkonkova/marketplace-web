/**
 * Опциональный прокси (если в environment apiBaseUrl = '/api/v1').
 * marketplace-api по умолчанию на :8080.
 */
const target = 'http://127.0.0.1:8082';

module.exports = {
  '/api': {
    target,
    secure: false,
    changeOrigin: true,
    logLevel: 'debug',
  },
};
