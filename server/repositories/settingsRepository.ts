import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { getPool } from "../db/pool.js";
import { DEFAULT_SETTINGS, settingsSchema, type Settings, type SettingsUpdate } from "../../lib/shared/schemas.js";

interface SettingsRow extends RowDataPacket {
  theme: Settings["theme"];
  font_family: string;
  font_size: number;
  toolbar_colors: unknown;
  storage_provider: Settings["storageProvider"];
  drive_folder_name: string;
}

function rowToSettings(row: SettingsRow): Settings {
  // mysql2 parses JSON columns; validate anyway so a hand-edited row can't break the UI.
  const parsed = settingsSchema.safeParse({
    theme: row.theme,
    fontFamily: row.font_family,
    fontSize: row.font_size,
    toolbarColors: row.toolbar_colors,
    storageProvider: row.storage_provider,
    driveFolderName: row.drive_folder_name,
  });
  if (!parsed.success) {
    console.warn("[settings] stored settings are invalid, falling back to defaults:", parsed.error.issues);
    return DEFAULT_SETTINGS;
  }
  return parsed.data;
}

export async function getSettings(): Promise<Settings> {
  const [rows] = await getPool().execute<SettingsRow[]>(
    `SELECT theme, font_family, font_size, toolbar_colors, storage_provider, drive_folder_name
       FROM settings WHERE id = 1`,
  );
  const row = rows[0];
  return row ? rowToSettings(row) : DEFAULT_SETTINGS;
}

const COLUMN_BY_FIELD = {
  theme: "theme",
  fontFamily: "font_family",
  fontSize: "font_size",
  toolbarColors: "toolbar_colors",
  storageProvider: "storage_provider",
  driveFolderName: "drive_folder_name",
} as const satisfies Record<keyof Settings, string>;

/** Applies a partial update (upserting the singleton row) and returns the new settings. */
export async function updateSettings(update: SettingsUpdate): Promise<Settings> {
  const merged: Settings = { ...(await getSettings()), ...update };
  const fields = Object.keys(COLUMN_BY_FIELD) as (keyof Settings)[];
  const columns = fields.map((f) => COLUMN_BY_FIELD[f]);
  const values = fields.map((f) => (f === "toolbarColors" ? JSON.stringify(merged[f]) : merged[f]));

  await getPool().execute<ResultSetHeader>(
    `INSERT INTO settings (id, ${columns.join(", ")})
          VALUES (1, ${columns.map(() => "?").join(", ")}) AS incoming
     ON DUPLICATE KEY UPDATE ${columns.map((c) => `${c} = incoming.${c}`).join(", ")}`,
    values,
  );
  return merged;
}
