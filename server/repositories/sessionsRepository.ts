import type { RowDataPacket } from "mysql2/promise";
import { getPool } from "../db/pool.js";
import type { AuthUser, Role } from "../../lib/shared/schemas.js";

interface SessionUserRow extends RowDataPacket {
  id: string;
  email: string;
  name: string | null;
  avatar_url: string | null;
  role: Role;
  expires_at: Date;
  last_seen_at: Date;
}

export async function createSession(tokenHash: string, userId: string, expiresAt: Date, userAgent: string | null): Promise<void> {
  await getPool().execute("INSERT INTO sessions (token_hash, user_id, expires_at, user_agent) VALUES (?, ?, ?, ?)", [
    tokenHash,
    userId,
    expiresAt,
    userAgent?.slice(0, 255) ?? null,
  ]);
}

/** The user behind a live session, plus the session's timestamps (for sliding renewal). */
export async function findSessionUser(
  tokenHash: string,
): Promise<{ user: AuthUser; expiresAt: Date; lastSeenAt: Date } | null> {
  const [rows] = await getPool().execute<SessionUserRow[]>(
    `SELECT u.id, u.email, u.name, u.avatar_url, u.role, s.expires_at, s.last_seen_at
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ? AND s.expires_at > CURRENT_TIMESTAMP`,
    [tokenHash],
  );
  const r = rows[0];
  if (!r) return null;
  return {
    user: { id: r.id, email: r.email, name: r.name, avatarUrl: r.avatar_url, role: r.role },
    expiresAt: r.expires_at,
    lastSeenAt: r.last_seen_at,
  };
}

export async function renewSession(tokenHash: string, expiresAt: Date): Promise<void> {
  await getPool().execute("UPDATE sessions SET expires_at = ?, last_seen_at = CURRENT_TIMESTAMP WHERE token_hash = ?", [
    expiresAt,
    tokenHash,
  ]);
}

export async function deleteSession(tokenHash: string): Promise<void> {
  await getPool().execute("DELETE FROM sessions WHERE token_hash = ?", [tokenHash]);
}

export async function deleteExpiredSessions(): Promise<void> {
  await getPool().execute("DELETE FROM sessions WHERE expires_at <= CURRENT_TIMESTAMP");
}
