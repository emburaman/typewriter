import type { AuthConfig, AuthUser, Invite, UserSummary } from "@/lib/shared/schemas";
import { request } from "./client";

export const getAuthConfig = () => request<AuthConfig>("GET", "/auth/config");
/** The signed-in user; rejects with a 401 ApiError when signed out. */
export const getMe = () => request<AuthUser>("GET", "/auth/me");
export const logout = () => request<void>("POST", "/auth/logout");
/** Test-only sign-in (only when the server runs with AUTH_DEV_LOGIN). */
export const devLogin = (email: string) => request<AuthUser>("POST", "/auth/dev-login", { email });
/** Full-page navigation target that starts "Sign in with Google". */
export const GOOGLE_LOGIN_URL = "/api/auth/login";

export const listUsers = () => request<UserSummary[]>("GET", "/users");
export const inviteUser = (invite: Invite) => request<UserSummary>("POST", "/users", invite);
export const removeUser = (id: string) => request<void>("DELETE", `/users/${encodeURIComponent(id)}`);
