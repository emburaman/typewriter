import type { Folder, FolderCreate, FolderUpdate, WithDriveWarning } from "@/lib/shared/schemas";
import { request } from "./client";

export const listFolders = () => request<Folder[]>("GET", "/folders");
export const createFolder = (folder: FolderCreate) => request<WithDriveWarning<Folder>>("POST", "/folders", folder);
/** Rename and/or move (`parentId: null` = top level). */
export const updateFolder = (id: string, update: FolderUpdate) =>
  request<WithDriveWarning<Folder>>("PATCH", `/folders/${encodeURIComponent(id)}`, update);
/** Deletes the folder; its contents move up to its parent. */
export const deleteFolder = (id: string) =>
  request<{ driveWarning?: string } | undefined>("DELETE", `/folders/${encodeURIComponent(id)}`);
