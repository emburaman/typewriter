/**
 * Types and zod schemas shared by the browser (lib/api) and the Express server.
 * Keep this file free of relative imports so both module systems can consume it.
 */
import { z } from "zod";

/* ------------------------------------------------------------------ */
/* Constants                                                           */
/* ------------------------------------------------------------------ */

export const MAX_TOOLBAR_COLORS = 5;
export const AUTOSAVE_INTERVAL_MS = 5_000;
export const FONT_SIZE_MIN = 12;
export const FONT_SIZE_MAX = 32;

export const THEMES = ["light", "dark", "system"] as const;
export const STORAGE_PROVIDERS = ["server", "google_drive"] as const;

/** Mid-tone defaults that stay legible on both light and dark backgrounds. */
export const DEFAULT_TOOLBAR_COLORS = ["#d64541", "#2e86de", "#27ae60", "#e67e22", "#9b59b6"];

/** Curated Google Fonts offered when no Google Fonts API key is configured. */
export const CURATED_FONTS = [
  "Courier Prime",
  "Special Elite",
  "IBM Plex Mono",
  "JetBrains Mono",
  "Space Mono",
  "Cutive Mono",
  "Literata",
  "Merriweather",
  "Lora",
  "EB Garamond",
  "Crimson Pro",
  "Source Serif 4",
  "Inter",
  "Work Sans",
] as const;

/* ------------------------------------------------------------------ */
/* Settings                                                            */
/* ------------------------------------------------------------------ */

const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Colors must be 6-digit hex values like #1a2b3c");

/** Google Fonts family names: letters, digits, spaces (e.g. "Source Serif 4"). */
const fontFamily = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .regex(/^[A-Za-z0-9 ]+$/, "Font family may only contain letters, digits and spaces");

export const settingsSchema = z.object({
  theme: z.enum(THEMES),
  fontFamily,
  fontSize: z.number().int().min(FONT_SIZE_MIN).max(FONT_SIZE_MAX),
  toolbarColors: z.array(hexColor).min(1).max(MAX_TOOLBAR_COLORS),
  storageProvider: z.enum(STORAGE_PROVIDERS),
  driveFolderName: z.string().trim().min(1).max(255),
});
export type Settings = z.infer<typeof settingsSchema>;

/** PUT /api/settings accepts any subset of fields. */
export const settingsUpdateSchema = settingsSchema.partial();
export type SettingsUpdate = z.infer<typeof settingsUpdateSchema>;

export const DEFAULT_SETTINGS: Settings = {
  theme: "system",
  fontFamily: "Courier Prime",
  fontSize: 18,
  toolbarColors: DEFAULT_TOOLBAR_COLORS,
  storageProvider: "server",
  driveFolderName: "Olive Writer",
};

/* ------------------------------------------------------------------ */
/* Documents                                                           */
/* ------------------------------------------------------------------ */

/** ProseMirror/TipTap JSON document. Validated structurally (must be a `doc` node). */
export const editorJsonSchema = z
  .object({ type: z.literal("doc"), content: z.array(z.unknown()).optional() })
  .passthrough();
export type EditorJson = z.infer<typeof editorJsonSchema>;

/** ~4 MB of HTML is plenty for a single piece of writing and keeps MEDIUMTEXT safe. */
const MAX_HTML_LENGTH = 4_000_000;

export const documentIdSchema = z.uuid();
const nullableId = z.uuid().nullable();

export const documentWriteSchema = z.object({
  title: z.string().trim().max(255).default("Untitled"),
  /** Only used when the document is created; existing documents move via PATCH. */
  folderId: nullableId.optional(),
  contentJson: editorJsonSchema,
  contentHtml: z.string().max(MAX_HTML_LENGTH),
  wordCount: z.number().int().min(0).default(0),
});
export type DocumentWrite = z.input<typeof documentWriteSchema>;

/** PATCH /api/documents/:id — currently only moving between folders. */
export const documentMoveSchema = z.object({ folderId: nullableId }).strict();
export type DocumentMove = z.infer<typeof documentMoveSchema>;

export interface DocumentSummary {
  id: string;
  title: string;
  folderId: string | null;
  wordCount: number;
  updatedAt: string;
  driveFileId: string | null;
  driveSyncedAt: string | null;
}

export interface DocumentRecord extends DocumentSummary {
  contentJson: EditorJson;
  contentHtml: string;
  createdAt: string;
}

/** Result of PUT /api/documents/:id — includes Drive sync outcome when enabled. */
export interface DocumentSaveResult {
  document: DocumentRecord;
  drive: { status: "skipped" | "synced" | "failed"; message?: string };
}

/* ------------------------------------------------------------------ */
/* Folders                                                             */
/* ------------------------------------------------------------------ */

const folderName = z.string().trim().min(1, "Folder name is required").max(255);

export const folderCreateSchema = z
  .object({ name: folderName, parentId: nullableId.default(null) })
  .strict();
export type FolderCreate = z.input<typeof folderCreateSchema>;

export const folderUpdateSchema = z
  .object({ name: folderName.optional(), parentId: nullableId.optional() })
  .strict()
  .refine((v) => v.name !== undefined || v.parentId !== undefined, "Nothing to update");
export type FolderUpdate = z.infer<typeof folderUpdateSchema>;

export interface Folder {
  id: string;
  name: string;
  parentId: string | null;
  createdAt: string;
  updatedAt: string;
}

/* ------------------------------------------------------------------ */
/* Google Drive                                                        */
/* ------------------------------------------------------------------ */

export interface GoogleStatus {
  /** Server has GOOGLE_CLIENT_ID / SECRET / REDIRECT_URI configured. */
  configured: boolean;
  connected: boolean;
  /** False when connected but the Drive permission was left unticked on Google's consent screen. */
  driveAccess: boolean;
  accountEmail: string | null;
  folderId: string | null;
}

/* ------------------------------------------------------------------ */
/* Errors                                                              */
/* ------------------------------------------------------------------ */

export interface ApiErrorBody {
  error: { code: string; message: string; details?: unknown };
}
