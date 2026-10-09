import type { GoogleStatus } from "@/lib/shared/schemas";
import { request } from "./client";

export const getGoogleStatus = () => request<GoogleStatus>("GET", "/google/status");
export const getGoogleAuthUrl = () => request<{ url: string }>("GET", "/google/auth-url");
export const disconnectGoogle = () => request<void>("DELETE", "/google/connection");
