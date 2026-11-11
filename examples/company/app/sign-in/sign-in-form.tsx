"use client";

import { type FormEvent, useState } from "react";
import { authClient } from "@/lib/auth-client";

/**
 * Where to go after signing in: `next` from the address, if it's on this site, or the home page. It's read as the
 * browser would read it, so spellings such as `/\other.example` that leave the site are refused.
 */
function nextPath(): string {
  const next = new URLSearchParams(location.search).get("next") ?? "/";
  try {
    const target = new URL(next, location.origin);
    return target.origin === location.origin ? `${target.pathname}${target.search}${target.hash}` : "/";
  } catch {
    return "/";
  }
}

export function SignInForm() {
  const [problem, setProblem] = useState<string>();
  const [busy, setBusy] = useState(false);
  // After the password, for someone who has turned on two-factor sign-in.
  const [code, setCode] = useState<"app" | "backup">();

  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setProblem(undefined);
    try {
      const { data, error } = await authClient.signIn.email({
        email: String(form.get("email")),
        password: String(form.get("password")),
      });
      if (error?.status === 429)
        return setProblem("That's too many tries for now. Wait a few minutes, then try again.");
      if (error) return setProblem("That email address and password don't match an account here.");
      if (data && "twoFactorRedirect" in data && data.twoFactorRedirect) return setCode("app");
      location.assign(nextPath());
    } catch {
      setProblem("Signing in didn't work. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  async function verify(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const given = String(new FormData(event.currentTarget).get("code")).replace(/\s/g, "");
    setBusy(true);
    setProblem(undefined);
    try {
      const { error } =
        code === "backup"
          ? await authClient.twoFactor.verifyBackupCode({ code: given })
          : await authClient.twoFactor.verifyTotp({ code: given });
      if (error?.status === 429) {
        return setProblem("That's too many tries for now. Wait a few minutes, then try again.");
      }
      if (error?.status === 401 && error.code === "INVALID_TWO_FACTOR_COOKIE") {
        setCode(undefined);
        return setProblem("That took too long. Sign in again.");
      }
      if (error) return setProblem("That code didn't work. Check it and try again.");
      location.assign(nextPath());
    } catch {
      setProblem("Signing in didn't work. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  if (code) {
    return (
      <form onSubmit={verify} className="grid gap-4" key={code}>
        <label className="grid gap-1">
          {code === "app" ? "Code from your authenticator app" : "Backup code"}
          <input
            name="code"
            autoComplete="one-time-code"
            inputMode={code === "app" ? "numeric" : "text"}
            required
            className="rounded border px-3 py-2"
          />
        </label>
        {problem && <p role="alert">{problem}</p>}
        <button type="submit" disabled={busy} className="rounded bg-primary px-4 py-2 text-primary-foreground">
          {busy ? "Checking…" : "Continue"}
        </button>
        <p>
          <button
            type="button"
            onClick={() => {
              setProblem(undefined);
              setCode(code === "app" ? "backup" : "app");
            }}
          >
            {code === "app" ? "Use a backup code instead" : "Use your authenticator app instead"}
          </button>
        </p>
      </form>
    );
  }

  return (
    <form onSubmit={signIn} className="grid gap-4">
      <label className="grid gap-1">
        Email address
        <input name="email" type="email" autoComplete="email" required className="rounded border px-3 py-2" />
      </label>
      <label className="grid gap-1">
        Password
        <input
          name="password"
          type="password"
          autoComplete="current-password"
          required
          className="rounded border px-3 py-2"
        />
      </label>
      {problem && <p role="alert">{problem}</p>}
      <button type="submit" disabled={busy} className="rounded bg-primary px-4 py-2 text-primary-foreground">
        {busy ? "Signing in…" : "Sign in"}
      </button>
      <p>
        <a href="/reset-password/">Forgot your password?</a>
      </p>
    </form>
  );
}
