export const environment = {
  production: false,
  /**
   * Прямой URL на marketplace-api (:8080). CORS — в marketplace-api/.env (CORS_ORIGINS).
   * Прокси /api в proxy.conf.js не подхватывается без полного перезапуска ng serve;
   * на :8082 часто висит Apache (EnterpriseDB), оттуда и были 404.
   */
  apiBaseUrl: 'http://192.168.64.2:8080/api/v1',
};
