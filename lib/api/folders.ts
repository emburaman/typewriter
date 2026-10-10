import type { Folder, FolderCreate, FolderUpdate } from "@/lib/shared/schemas";
import { request } from "./client";

export const listFolders = () => request<Folder[]>("GET", "/folders");
export const createFolder = (folder: FolderCreate) => request<Folder>("POST", "/folders", folder);
/** Rename and/or move (`parentId: null` = top level). */
export const updateFolder = (id: string, update: FolderUpdate) =>
  request<Folder>("PATCH", `/folders/${encodeURIComponent(id)}`, update);
/** Deletes the folder; its contents move up to its parent. */
export const deleteFolder = (id: string) => request<void>("DELETE", `/folders/${encodeURIComponent(id)}`);
