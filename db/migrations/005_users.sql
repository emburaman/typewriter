-- 005_users: accounts (Google sign-in, invite-only), sessions, and per-user data.
--
-- Users are identified by their Google account. An "invited" user is a row whose google_sub is
-- still NULL; it is linked to the Google account on first sign-in with that email.
--
-- Existing single-user data (documents, folders, the settings row and the Drive connection)
-- keeps user_id = NULL here and is claimed by the first admin when they first sign in
-- (see server/repositories/usersRepository.ts → bootstrapAdmin). Every query filters on
-- user_id, so unclaimed rows are invisible until then.

CREATE TABLE IF NOT EXISTS users (
  id            CHAR(36)      NOT NULL PRIMARY KEY,
  email         VARCHAR(255)  NOT NULL,
  name          VARCHAR(255)  NULL,
  avatar_url    VARCHAR(1024) NULL,
  google_sub    VARCHAR(64)   NULL,
  role          ENUM('admin', 'user') NOT NULL DEFAULT 'user',
  invited_by    CHAR(36)      NULL,
  created_at    TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_login_at TIMESTAMP     NULL,
  UNIQUE KEY uq_users_email (email),
  UNIQUE KEY uq_users_google_sub (google_sub)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Only a SHA-256 hash of the session token is stored; the token itself lives in the cookie.
CREATE TABLE IF NOT EXISTS sessions (
  token_hash   CHAR(64)     NOT NULL PRIMARY KEY,
  user_id      CHAR(36)     NOT NULL,
  created_at   TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at   TIMESTAMP    NOT NULL,
  last_seen_at TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  user_agent   VARCHAR(255) NULL,
  INDEX idx_sessions_user (user_id),
  INDEX idx_sessions_expires (expires_at),
  CONSTRAINT fk_sessions_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Per-user replacement for the single-row `settings` table.
CREATE TABLE IF NOT EXISTS user_settings (
  user_id           CHAR(36)     NOT NULL PRIMARY KEY,
  theme             ENUM('light', 'dark', 'system') NOT NULL DEFAULT 'system',
  font_family       VARCHAR(100) NOT NULL DEFAULT 'Courier Prime',
  font_size         TINYINT UNSIGNED NOT NULL DEFAULT 18,
  toolbar_colors    JSON         NOT NULL,
  storage_provider  ENUM('server', 'google_drive') NOT NULL DEFAULT 'server',
  drive_folder_name VARCHAR(255) NOT NULL DEFAULT 'Olive Writer',
  updated_at        TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_user_settings_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Per-user replacement for the single-row `google_credentials` table.
CREATE TABLE IF NOT EXISTS drive_connections (
  user_id           CHAR(36)     NOT NULL PRIMARY KEY,
  access_token_enc  TEXT         NULL,
  refresh_token_enc TEXT         NULL,
  expiry_date       BIGINT       NULL,
  scope             VARCHAR(512) NULL,
  account_email     VARCHAR(255) NULL,
  folder_id         VARCHAR(128) NULL,
  connected_at      TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_drive_connections_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Documents and folders belong to a user. RESTRICT (not CASCADE): removing a user deletes
-- their writing explicitly, in a transaction, in the app — never as a side effect.
ALTER TABLE documents
  ADD COLUMN user_id CHAR(36) NULL AFTER id,
  ADD INDEX idx_documents_user (user_id),
  ADD CONSTRAINT fk_documents_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE RESTRICT;

ALTER TABLE folders
  ADD COLUMN user_id CHAR(36) NULL AFTER id,
  ADD INDEX idx_folders_user (user_id),
  ADD CONSTRAINT fk_folders_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE RESTRICT;
