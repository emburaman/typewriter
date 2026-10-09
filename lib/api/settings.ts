import type { Settings, SettingsUpdate } from "@/lib/shared/schemas";
import { request } from "./client";

export const getSettings = () => request<Settings>("GET", "/settings");
export const updateSettings = (update: SettingsUpdate) => request<Settings>("PUT", "/settings", update);
