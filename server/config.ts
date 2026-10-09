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

  const googleConfigured = Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET && encryptionKey);

  return {
    nodeEnv: env.NODE_ENV,
    isProduction: env.NODE_ENV === "production",
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
    google: {
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
