"use client";

import { useEffect, useState, type FormEvent } from "react";
import { ApiError, devLogin, getAuthConfig, GOOGLE_LOGIN_URL } from "@/lib/api";
import type { AuthConfig } from "@/lib/shared/schemas";
import { Logo } from "./Logo";

const ERRORS: Record<string, string> = {
  not_invited: "This Google account hasn't been invited yet. Ask the admin to add your email in Settings → Users.",
  admin_only: "The first account must be the admin's (ADMIN_EMAIL). Sign in with that Google account.",
  email_unverified: "Your Google account's email address isn't verified.",
  denied: "Sign-in was cancelled.",
  expired: "The sign-in link expired. Please try again.",
  not_configured: "Google sign-in isn't configured on this server (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET).",
  google: "Google sign-in failed. Please try again.",
};

function GoogleMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.6 5.4 2.7 13.3l7.9 6.2C12.5 13.6 17.8 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.7 6c4.5-4.2 6.9-10.3 6.9-17.7z" />
      <path fill="#FBBC05" d="M10.6 28.5c-.5-1.4-.8-3-.8-4.5s.3-3.1.8-4.5l-7.9-6.2C1 16.6 0 20.2 0 24s1 7.4 2.7 10.7l7.9-6.2z" />
      <path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.7-6c-2.2 1.5-5 2.3-8.2 2.3-6.2 0-11.5-4.1-13.4-9.9l-7.9 6.2C6.6 42.6 14.6 48 24 48z" />
    </svg>
  );
}

export function LoginView() {
  const [config, setConfig] = useState<AuthConfig | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [devEmail, setDevEmail] = useState("");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get("error");
    if (code) setError(params.get("message") ?? ERRORS[code] ?? ERRORS.google ?? "Sign-in failed.");
    getAuthConfig()
      .then(setConfig)
      .catch((err: unknown) => setError(`Can't reach the server: ${err instanceof Error ? err.message : String(err)}`));
  }, []);

  const submitDev = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await devLogin(devEmail);
      window.location.assign("/");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    }
  };

  return (
    <main className="login-page">
      <div className="login-card">
        <Logo height={30} />
        <p className="login-tagline">A quiet place to write.</p>

        {config?.needsSetup && (
          <p className="hint login-note">
            Welcome! No account exists yet — the first person to sign in becomes the <strong>admin</strong> and keeps
            any writing already on this server. The admin then invites everyone else.
          </p>
        )}

        <a
          className={`btn btn-google${config && !config.googleConfigured ? " disabled" : ""}`}
          href={GOOGLE_LOGIN_URL}
          aria-disabled={config ? !config.googleConfigured : undefined}
        >
          <GoogleMark /> Sign in with Google
        </a>

        {error && (
          <p className="error-text" role="alert">
            {error}
          </p>
        )}
        {config && !config.googleConfigured && !error && <p className="error-text">{ERRORS.not_configured}</p>}
        {config?.googleConfigured && !config.needsSetup && !error && <p className="hint">Invited accounts only.</p>}

        {config?.devLogin && (
          <form className="dev-login" onSubmit={(e) => void submitDev(e)}>
            <p className="hint">Test sign-in (AUTH_DEV_LOGIN — never enabled in production)</p>
            <div className="row">
              <input
                className="input"
                type="email"
                aria-label="Test sign-in email"
                placeholder="someone@example.com"
                value={devEmail}
                onChange={(e) => setDevEmail(e.target.value)}
              />
              <button type="submit" className="btn">
                Sign in
              </button>
            </div>
          </form>
        )}
      </div>
    </main>
  );
}
