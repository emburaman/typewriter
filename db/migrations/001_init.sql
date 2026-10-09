-- 001_init: core schema for the Typewriter app.
-- Single-user / self-hosted: `settings` and `google_credentials` hold exactly one row (id = 1).

CREATE TABLE IF NOT EXISTS settings (
  id               TINYINT UNSIGNED NOT NULL PRIMARY KEY,
  theme            ENUM('light', 'dark', 'system') NOT NULL DEFAULT 'system',
  font_family      VARCHAR(100)  NOT NULL DEFAULT 'Courier Prime',
  font_size        TINYINT UNSIGNED NOT NULL DEFAULT 18,
  toolbar_colors   JSON          NOT NULL,
  storage_provider ENUM('server', 'google_drive') NOT NULL DEFAULT 'server',
  drive_folder_name VARCHAR(255) NOT NULL DEFAULT 'Typewriter',
  updated_at       TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT chk_settings_singleton CHECK (id = 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO settings (id, toolbar_colors)
VALUES (1, JSON_ARRAY('#d64541', '#2e86de', '#27ae60', '#e67e22', '#9b59b6'));

CREATE TABLE IF NOT EXISTS documents (
  id              CHAR(36)      NOT NULL PRIMARY KEY,
  title           VARCHAR(255)  NOT NULL DEFAULT 'Untitled',
  content_json    JSON          NOT NULL,
  content_html    MEDIUMTEXT    NOT NULL,
  word_count      INT UNSIGNED  NOT NULL DEFAULT 0,
  drive_file_id   VARCHAR(128)  NULL,
  drive_synced_at TIMESTAMP     NULL,
  created_at      TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_documents_updated_at (updated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS google_credentials (
  id                TINYINT UNSIGNED NOT NULL PRIMARY KEY,
  -- Tokens are AES-256-GCM encrypted by the app (see server/services/crypto.ts).
  access_token_enc  TEXT          NULL,
  refresh_token_enc TEXT          NULL,
  expiry_date       BIGINT        NULL,
  scope             VARCHAR(512)  NULL,
  account_email     VARCHAR(255)  NULL,
  folder_id         VARCHAR(128)  NULL,
  connected_at      TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT chk_google_singleton CHECK (id = 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
