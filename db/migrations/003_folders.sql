-- 003_folders: let documents be organized in a tree of folders.
-- A NULL parent_id / folder_id means "at the top level".
-- Foreign keys are RESTRICT on purpose: deleting a folder is done by the app, which first moves
-- the folder's contents up to its parent in the same transaction, so nothing is ever cascaded away.

CREATE TABLE IF NOT EXISTS folders (
  id         CHAR(36)     NOT NULL PRIMARY KEY,
  name       VARCHAR(255) NOT NULL,
  parent_id  CHAR(36)     NULL,
  created_at TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_folders_parent (parent_id),
  CONSTRAINT fk_folders_parent FOREIGN KEY (parent_id) REFERENCES folders (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE documents
  ADD COLUMN folder_id CHAR(36) NULL AFTER title,
  ADD INDEX idx_documents_folder (folder_id),
  ADD CONSTRAINT fk_documents_folder FOREIGN KEY (folder_id) REFERENCES folders (id) ON DELETE RESTRICT;
