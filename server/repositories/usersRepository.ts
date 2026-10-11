import { randomUUID } from "node:crypto";
import type { PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { getPool } from "../db/pool.js";
import type { AuthUser, Role, UserSummary } from "../../lib/shared/schemas.js";

interface UserRow extends RowDataPacket {
  id: string;
  email: string;
  name: string | null;
  avatar_url: string | null;
  google_sub: string | null;
  role: Role;
  created_at: Date;
  last_login_at: Date | null;
}

const toAuthUser = (r: UserRow): AuthUser => ({
  id: r.id,
  email: r.email,
  name: r.name,
  avatarUrl: r.avatar_url,
  role: r.role,
});

const toSummary = (r: UserRow): UserSummary => ({
  ...toAuthUser(r),
  status: r.google_sub ? "active" : "invited",
  createdAt: r.created_at.toISOString(),
  lastLoginAt: r.last_login_at ? r.last_login_at.toISOString() : null,
});

export async function countUsers(): Promise<number> {
  const [rows] = await getPool().query<RowDataPacket[]>("SELECT COUNT(*) AS n FROM users");
  return Number(rows[0]?.n ?? 0);
}

export async function listUsers(): Promise<UserSummary[]> {
  const [rows] = await getPool().execute<UserRow[]>("SELECT * FROM users ORDER BY role, email");
  return rows.map(toSummary);
}

export async function findUserById(id: string): Promise<UserSummary | null> {
  const [rows] = await getPool().execute<UserRow[]>("SELECT * FROM users WHERE id = ?", [id]);
  return rows[0] ? toSummary(rows[0]) : null;
}

/** Profile details from Google, applied at every sign-in. */
export interface GoogleProfile {
  sub: string;
  email: string;
  name: string | null;
  picture: string | null;
}

/**
 * Resolves a Google sign-in to an account: the account already linked to this Google
 * identity, or an invited account with the same email (which gets linked now). Returns null
 * when the person was not invited.
 */
export async function signInWithGoogle(profile: GoogleProfile): Promise<AuthUser | null> {
  const pool = getPool();
  const email = profile.email.toLowerCase();
  const [bySub] = await pool.execute<UserRow[]>("SELECT * FROM users WHERE google_sub = ?", [profile.sub]);
  let row = bySub[0];
  if (!row) {
    const [byEmail] = await pool.execute<UserRow[]>("SELECT * FROM users WHERE email = ? AND google_sub IS NULL", [email]);
    row = byEmail[0];
  }
  if (!row) return null;
  await pool.execute(
    "UPDATE users SET google_sub = ?, email = ?, name = ?, avatar_url = ?, last_login_at = CURRENT_TIMESTAMP WHERE id = ?",
    [profile.sub, email, profile.name, profile.picture, row.id],
  );
  return toAuthUser({ ...row, email, name: profile.name, avatar_url: profile.picture });
}

/**
 * Creates the first account as admin and hands it everything created before accounts existed
 * (documents, folders, settings, Drive connection). All in one transaction; returns null if
 * someone else became admin first (concurrent first sign-ins).
 */
export async function bootstrapAdmin(profile: GoogleProfile): Promise<AuthUser | null> {
  const conn = await getPool().getConnection();
  // A named lock (not LOCK TABLES, which would implicitly commit the transaction) makes
  // concurrent first sign-ins take turns; the loser sees a non-empty users table.
  const [lock] = await conn.query<RowDataPacket[]>("SELECT GET_LOCK('olive_writer_bootstrap', 10) AS ok");
  if (Number(lock[0]?.ok) !== 1) {
    conn.release();
    throw new Error("Could not acquire the first-admin lock");
  }
  try {
    await conn.beginTransaction();
    const [count] = await conn.query<RowDataPacket[]>("SELECT COUNT(*) AS n FROM users");
    if (Number(count[0]?.n ?? 0) > 0) {
      await conn.rollback();
      return null;
    }
    const id = randomUUID();
    const email = profile.email.toLowerCase();
    await conn.execute(
      `INSERT INTO users (id, email, name, avatar_url, google_sub, role, last_login_at)
       VALUES (?, ?, ?, ?, ?, 'admin', CURRENT_TIMESTAMP)`,
      [id, email, profile.name, profile.picture, profile.sub],
    );
    await claimLegacyData(conn, id);
    await conn.commit();
    return { id, email, name: profile.name, avatarUrl: profile.picture, role: "admin" };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    await conn.query("SELECT RELEASE_LOCK('olive_writer_bootstrap')");
    conn.release();
  }
}

/** Single-user data (from before accounts existed) becomes the first admin's. */
async function claimLegacyData(conn: PoolConnection, userId: string): Promise<void> {
  await conn.execute("UPDATE documents SET user_id = ?, updated_at = updated_at WHERE user_id IS NULL", [userId]);
  await conn.execute("UPDATE folders SET user_id = ?, updated_at = updated_at WHERE user_id IS NULL", [userId]);
  await conn.execute(
    `INSERT INTO user_settings (user_id, theme, font_family, font_size, toolbar_colors, storage_provider, drive_folder_name)
     SELECT ?, theme, font_family, font_size, toolbar_colors, storage_provider, drive_folder_name FROM settings WHERE id = 1`,
    [userId],
  );
  await conn.execute(
    `INSERT INTO drive_connections
            (user_id, access_token_enc, refresh_token_enc, expiry_date, scope, account_email, folder_id, connected_at)
     SELECT ?, access_token_enc, refresh_token_enc, expiry_date, scope, account_email, folder_id, connected_at
       FROM google_credentials WHERE id = 1`,
    [userId],
  );
  // The legacy token now belongs to the admin; don't leave a second copy around.
  await conn.execute("DELETE FROM google_credentials");
}

/** Adds an invited account (linked to a Google identity on first sign-in). */
export async function inviteUser(email: string, role: Role, invitedBy: string): Promise<UserSummary> {
  const id = randomUUID();
  await getPool().execute("INSERT INTO users (id, email, role, invited_by) VALUES (?, ?, ?, ?)", [id, email.toLowerCase(), role, invitedBy]);
  const user = await findUserById(id);
  if (!user) throw new Error("Invited user vanished");
  return user;
}

export async function countAdmins(): Promise<number> {
  const [rows] = await getPool().query<RowDataPacket[]>("SELECT COUNT(*) AS n FROM users WHERE role = 'admin'");
  return Number(rows[0]?.n ?? 0);
}

/**
 * Removes an account and everything it owns (documents, folders, settings, Drive connection,
 * sessions). Copies already in the person's Google Drive are not touched.
 */
export async function deleteUserAndData(id: string): Promise<boolean> {
  const conn = await getPool().getConnection();
  try {
    await conn.beginTransaction();
    await conn.execute("DELETE FROM documents WHERE user_id = ?", [id]);
    // Folders reference each other (RESTRICT): detach the tree before deleting it.
    await conn.execute("UPDATE folders SET parent_id = NULL WHERE user_id = ?", [id]);
    await conn.execute("DELETE FROM folders WHERE user_id = ?", [id]);
    // user_settings, drive_connections and sessions cascade with the user row.
    const [result] = await conn.execute<ResultSetHeader>("DELETE FROM users WHERE id = ?", [id]);
    await conn.commit();
    return result.affectedRows > 0;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}
