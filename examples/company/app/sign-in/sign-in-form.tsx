"use client";

import { type FormEvent, useEffect, useState } from "react";
import { authClient, TOO_MANY } from "@/lib/auth-client";
import { nextPath } from "./next-path";

export function SignInForm() {
  const [problem, setProblem] = useState<string>();
  const [busy, setBusy] = useState(false);
  // After the password, for someone who has turned on two-factor sign-in.
  const [code, setCode] = useState<"app" | "backup">();
  // The address of an account that hasn't been confirmed yet, which can ask for its email again.
  const [unconfirmed, setUnconfirmed] = useState<string>();
  const [resent, setResent] = useState(false);
  // Signing up keeps where to go next, which only the browser knows, since the page is the same for everyone.
  const [signUp, setSignUp] = useState("/sign-up/");
  useEffect(() => setSignUp(`/sign-up/${location.search}`), []);

  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const email = String(form.get("email"));
    setBusy(true);
    setProblem(undefined);
    setUnconfirmed(undefined);
    setResent(false);
    try {
      const { data, error } = await authClient.signIn.email({ email, password: String(form.get("password")) });
      if (error?.status === 429) return setProblem(TOO_MANY);
      // The right password for an account whose address hasn't been confirmed yet.
      if (error?.status === 403 && error.code === "EMAIL_NOT_VERIFIED") {
        setUnconfirmed(email);
        return setProblem("Confirm your email address first, with the link we sent when you signed up.");
      }
      if (error) return setProblem("That email address and password don't match an account here.");
      if (data && "twoFactorRedirect" in data && data.twoFactorRedirect) return setCode("app");
      location.assign(nextPath());
    } catch {
      setProblem("Signing in didn't work. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  /** Asks for the email that confirms the address again, which answers the same whatever happened. */
  async function sendAgain(email: string) {
    setBusy(true);
    setProblem(undefined);
    try {
      const { error } = await authClient.sendVerificationEmail({ email, callbackURL: nextPath() });
      if (error?.status === 429) return setProblem(TOO_MANY);
      if (error) return setProblem("That didn't work. Try again in a moment.");
      setResent(true);
    } catch {
      setProblem("That didn't work. Check your connection and try again.");
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
      if (error?.status === 429) return setProblem(TOO_MANY);
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
      {unconfirmed &&
        (resent ? (
          <p role="status">We've sent the link again. It works for 24 hours.</p>
        ) : (
          <p>
            <button type="button" disabled={busy} onClick={() => void sendAgain(unconfirmed)}>
              Send the link again
            </button>
          </p>
        ))}
      <button type="submit" disabled={busy} className="rounded bg-primary px-4 py-2 text-primary-foreground">
        {busy ? "Signing in…" : "Sign in"}
      </button>
      <p>
        <a href="/reset-password/">Forgot your password?</a>
      </p>
      <p>
        No account? <a href={signUp}>Sign up</a>
      </p>
    </form>
  );
}
