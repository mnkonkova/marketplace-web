-- Пользователи для сквозных браузерных тестов.
--
-- Только люди: проект, состав и выкладки собираются через API в
-- fixtures/world.ts. Так путь данных остаётся настоящим, а SQL нужен
-- ровно для одного — чтобы было чем войти: регистрация требует
-- подтверждения почты, а письма локально никуда не уходят.
--
-- Скрипт идемпотентен и трогает только своё: адреса с префиксом e2e-.

BEGIN;

-- Убираем следы прошлого прогона. Порядок важен: проекты ссылаются на
-- пользователей, заказы — на проекты.
DELETE FROM creator_orders WHERE client_user_id IN
    (SELECT id FROM users WHERE email LIKE 'e2e-%@example.com');
DELETE FROM projects WHERE client_user_id IN
    (SELECT id FROM users WHERE email LIKE 'e2e-%@example.com');
-- Чужая строка, указывающая на посевного человека, держит его внешним
-- ключом, и пересев падает целиком — то есть мир перестаёт собираться,
-- как только протухли токены. Так бывает с любым проектом, заведённым на
-- посевного менеджера руками: «ответственный», «кто менял тариф», «кто
-- подтвердил платёж».
--
-- Обнуляем такие ссылки везде, где колонка это позволяет, и не трогаем
-- саму строку: она может быть не наша, и сносить её мы не вправе. Список
-- колонок берём из каталога, а не перечисляем руками: перечисленный
-- список устаревает молча — падение видно только через месяц и выглядит
-- как «сломался докер».
DO $$
DECLARE r RECORD;
BEGIN
    FOR r IN
        SELECT c.conrelid::regclass::text AS tbl, a.attname AS col
        FROM pg_constraint c
        JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
        WHERE c.contype = 'f'
          AND c.confrelid = 'users'::regclass
          AND array_length(c.conkey, 1) = 1
          AND NOT a.attnotnull
          -- Каскад и SET NULL база отрабатывает сама; мешают только
          -- NO ACTION и RESTRICT.
          AND c.confdeltype IN ('a', 'r')
    LOOP
        EXECUTE format(
            'UPDATE %s SET %I = NULL WHERE %I IN '
            '(SELECT id FROM users WHERE email LIKE ''e2e-%%@example.com'')',
            r.tbl, r.col, r.col);
    END LOOP;
END $$;
DELETE FROM users WHERE email LIKE 'e2e-%@example.com';
-- И то же самое с версией прайса: чужой проект мог снять с неё числа, и
-- тогда она не удаляется. Снимок в проекте от этого не портится — суммы
-- в нём свои, ссылка нужна только чтобы сказать, откуда они взялись.
UPDATE project_billing SET terms_version_id = NULL
WHERE terms_version_id IN
    (SELECT id FROM terms_versions WHERE body = 'E2E: условия работы');
DELETE FROM terms_versions WHERE body = 'E2E: условия работы';

-- Пароль у всех троих один: E2ePassw0rd!
-- Хеш bcrypt, тот же алгоритм и стоимость, что у регистрации.
INSERT INTO users (email, password_hash, kind, is_manager, is_admin,
                   is_approved, is_active, email_verified_at, display_name)
VALUES
  ('e2e-manager@example.com', '$2a$10$VLL7gXAlXcbWgcG/qthyKOU0Upz4iMk1.E1L9pQHkngMHaYwVXLFa',
   'client', TRUE, FALSE, TRUE, TRUE, now(), 'Мария Менеджер'),
  ('e2e-creator@example.com', '$2a$10$VLL7gXAlXcbWgcG/qthyKOU0Upz4iMk1.E1L9pQHkngMHaYwVXLFa',
   'specialist', FALSE, FALSE, TRUE, TRUE, now(), 'Анастасия Креатор'),
  ('e2e-client@example.com',  '$2a$10$VLL7gXAlXcbWgcG/qthyKOU0Upz4iMk1.E1L9pQHkngMHaYwVXLFa',
   'client', FALSE, FALSE, TRUE, TRUE, now(), 'PetFlat'),
  ('e2e-admin@example.com',   '$2a$10$VLL7gXAlXcbWgcG/qthyKOU0Upz4iMk1.E1L9pQHkngMHaYwVXLFa',
   'client', TRUE, TRUE, TRUE, TRUE, now(), 'Админ Тестовый');

-- Креатор должен быть опубликованным специалистом креаторской категории:
-- иначе подбор его не пропустит, и это правильно.
INSERT INTO specialist_profiles (user_id, display_name, is_published, social_links)
SELECT id, 'Анастасия Креатор', TRUE, '{"tiktok":"https://tiktok.com/@nastya"}'::jsonb
FROM users WHERE email = 'e2e-creator@example.com';

INSERT INTO specialist_categories (user_id, category_code, is_primary)
SELECT id, 'ugc', TRUE FROM users WHERE email = 'e2e-creator@example.com'
ON CONFLICT DO NOTHING;

-- Тариф из референса: оклад 60 000 ₽ за 30 роликов, 90 ₽ за 1000
-- просмотров до миллиона на ролик и 9 ₽ свыше. Всё в копейках.
INSERT INTO terms_versions (version, body, salary_per_month, videos_first_month,
                            videos_next_months, rate_per_1000_views,
                            bonus_views_threshold, rate_per_1000_views_over)
VALUES ((SELECT COALESCE(MAX(version), 0) + 1 FROM terms_versions),
        'E2E: условия работы', 6000000, 30, 60, 9000, 1000000, 900);

COMMIT;
