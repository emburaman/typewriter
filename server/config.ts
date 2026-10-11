import { loadEnvConfig } from "@next/env";
import { z } from "zod";

// Load .env, .env.local, .env.development / .env.production (same rules as Next.js).
// Variables already present in the environment (e.g. from Docker Compose) always win.
loadEnvConfig(process.cwd(), process.env.NODE_ENV !== "production", { info: () => {}, error: console.error });

/**
 * Environment configuration, validated once at boot. Anything invalid fails fast
 * with a readable message instead of surfacing later as an obscure runtime error.
 */
const emptyToUndefined = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);
const optionalString = z.preprocess(emptyToUndefined, z.string().optional());

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  APP_URL: z.url().default("http://localhost:4000"),

  DB_HOST: z.string().default("localhost"),
  DB_PORT: z.coerce.number().int().positive().default(3306),
  DB_USER: z.string().default("typewriter"),
  DB_PASSWORD: z.string().default(""),
  DB_NAME: z.string().default("typewriter"),
  DB_CONNECTION_LIMIT: z.coerce.number().int().positive().default(10),

  /** 32 random bytes, base64 encoded. Required to store Google tokens. */
  TOKEN_ENCRYPTION_KEY: optionalString,

  GOOGLE_CLIENT_ID: optionalString,
  GOOGLE_CLIENT_SECRET: optionalString,
  GOOGLE_REDIRECT_URI: z.preprocess(emptyToUndefined, z.url().optional()),
  GOOGLE_FONTS_API_KEY: optionalString,

  /** Only this Google account may become the first admin. Strongly recommended on public servers. */
  ADMIN_EMAIL: z.preprocess(emptyToUndefined, z.email().optional()),
  /** Test-only password-less sign-in (POST /api/auth/dev-login). Refused when NODE_ENV=production. */
  AUTH_DEV_LOGIN: z.preprocess((v) => v === "true" || v === "1", z.boolean()).default(false),
});

function loadConfig() {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  const env = parsed.data;

  let encryptionKey: Buffer | null = null;
  if (env.TOKEN_ENCRYPTION_KEY) {
    encryptionKey = Buffer.from(env.TOKEN_ENCRYPTION_KEY, "base64");
    if (encryptionKey.length !== 32) {
      throw new Error("TOKEN_ENCRYPTION_KEY must be 32 bytes, base64 encoded (openssl rand -base64 32)");
    }
  }

  if (env.AUTH_DEV_LOGIN && env.NODE_ENV === "production") {
    throw new Error("AUTH_DEV_LOGIN must never be enabled when NODE_ENV=production");
  }

  // Sign-in only needs the OAuth client; storing Drive tokens also needs the encryption key.
  const oauthConfigured = Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);
  const googleConfigured = oauthConfigured && Boolean(encryptionKey);

  return {
    nodeEnv: env.NODE_ENV,
    isProduction: env.NODE_ENV === "production",
    /** Next.js dev server (hot reload) only in development; "test" serves the production build. */
    isDev: env.NODE_ENV === "development",
    port: env.PORT,
    appUrl: env.APP_URL.replace(/\/$/, ""),
    db: {
      host: env.DB_HOST,
      port: env.DB_PORT,
      user: env.DB_USER,
      password: env.DB_PASSWORD,
      database: env.DB_NAME,
      connectionLimit: env.DB_CONNECTION_LIMIT,
    },
    encryptionKey,
    /** https deployments get Secure cookies. */
    secureCookies: env.APP_URL.startsWith("https://"),
    auth: {
      oauthConfigured,
      adminEmail: env.ADMIN_EMAIL?.toLowerCase() ?? null,
      devLogin: env.AUTH_DEV_LOGIN,
    },
    google: {
      /** Drive storage available (OAuth client + token encryption key). */
      configured: googleConfigured,
      clientId: env.GOOGLE_CLIENT_ID ?? "",
      clientSecret: env.GOOGLE_CLIENT_SECRET ?? "",
      redirectUri: env.GOOGLE_REDIRECT_URI ?? `${env.APP_URL.replace(/\/$/, "")}/api/google/callback`,
    },
    googleFontsApiKey: env.GOOGLE_FONTS_API_KEY ?? null,
  } as const;
}

export type AppConfig = ReturnType<typeof loadConfig>;
export const config: AppConfig = loadConfig();
