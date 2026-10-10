-- 002_olive_writer_rename: the app is now "Olive Writer"; use that as the default Drive folder.
-- Existing installs keep their folder unless Google Drive was never connected (in which case no
-- folder has been created yet and the old default is simply replaced).

ALTER TABLE settings ALTER COLUMN drive_folder_name SET DEFAULT 'Olive Writer';

UPDATE settings
   SET drive_folder_name = 'Olive Writer'
 WHERE id = 1
   AND drive_folder_name = 'Typewriter'
   AND NOT EXISTS (SELECT 1 FROM google_credentials);
