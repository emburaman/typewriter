-- 008_highlight_colors: per-user highlight palette (up to 5 colors, like toolbar_colors).
-- NULL means "not customized yet": the app falls back to its default highlight colors.

ALTER TABLE user_settings
  ADD COLUMN highlight_colors JSON NULL AFTER toolbar_colors;
