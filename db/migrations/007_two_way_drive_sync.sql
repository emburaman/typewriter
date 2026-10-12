-- 007_two_way_drive_sync: pull changes from Google Drive back into the app, and a trash.
--
-- documents:
--   deleted_at            app Trash (soft delete): deletions on either side land here first,
--                         restorable for 30 days, so a mistaken delete in Drive never loses writing.
--   content_source        'html' when the content was pulled from Google Docs and hasn't been
--                         opened in the editor yet (content_json is then stale; content_html wins).
--   drive_version         Drive's file version right after our last sync (higher = changed in Drive).
--   drive_content_hash    SHA-256 of Drive's HTML export after our last sync (detects real content
--                         edits; metadata-only version bumps are ignored).
--   drive_synced_revision app revision at the last sync (higher = changed in the app since).
--   drive_account         Google account the Drive file belongs to (a different account's files
--                         are never treated as "deleted").
-- folders:
--   drive_name            Drive folder name at the last sync (tells app renames from Drive renames).

ALTER TABLE documents
  ADD COLUMN deleted_at TIMESTAMP NULL AFTER drive_synced_at,
  ADD COLUMN content_source ENUM('json', 'html') NOT NULL DEFAULT 'json' AFTER content_html,
  ADD COLUMN drive_version BIGINT NULL AFTER drive_file_id,
  ADD COLUMN drive_content_hash CHAR(64) NULL AFTER drive_version,
  ADD COLUMN drive_synced_revision INT UNSIGNED NULL AFTER drive_content_hash,
  ADD COLUMN drive_account VARCHAR(255) NULL AFTER drive_synced_revision,
  ADD INDEX idx_documents_deleted (user_id, deleted_at),
  ADD INDEX idx_documents_drive_file (drive_file_id);

ALTER TABLE folders ADD COLUMN drive_name VARCHAR(255) NULL AFTER drive_folder_id;

ALTER TABLE drive_connections ADD COLUMN last_pull_at TIMESTAMP NULL AFTER folder_id;
