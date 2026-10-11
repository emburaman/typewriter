-- 004_folder_drive_sync: mirror app folders as Google Drive folders.
-- drive_folder_id is the Drive folder this app folder maps to (NULL = not created in Drive yet).
-- It is only a cache: if the Drive folder is missing or trashed it is recreated on the next sync.

ALTER TABLE folders ADD COLUMN drive_folder_id VARCHAR(128) NULL AFTER parent_id;
