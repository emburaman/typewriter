-- 006_document_revisions: optimistic concurrency for cross-device editing.
-- Every successful save increments `revision`. A save must name the revision it was based on;
-- if another device saved in between, the save is refused (409) instead of overwriting it.

ALTER TABLE documents ADD COLUMN revision INT UNSIGNED NOT NULL DEFAULT 1 AFTER word_count;
