import type { DriveSyncAllResult, GoogleStatus } from "@/lib/shared/schemas";
import { request } from "./client";

export const getGoogleStatus = () => request<GoogleStatus>("GET", "/google/status");
export const getGoogleAuthUrl = () => request<{ url: string }>("GET", "/google/auth-url");
/** Brings in changes made in Google Drive now (no-op if Drive sync is off or ran moments ago). */
export const pullFromDrive = () => request<unknown>("POST", "/google/pull");
/** Mirrors every folder and uploads every document to Drive. */
export const syncDriveNow = () => request<DriveSyncAllResult>("POST", "/google/sync");
export const disconnectGoogle = () => request<void>("DELETE", "/google/connection");
