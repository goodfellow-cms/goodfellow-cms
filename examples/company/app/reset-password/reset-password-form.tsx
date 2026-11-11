"use client";

import { type FormEvent, useEffect, useState } from "react";
import { authClient } from "@/lib/auth-client";
import { NewPasswordFields, passwordProblem } from "./new-password-fields";

/** Asks for an email with a link, or, with the link's token, takes the new password. */
export function ResetPasswordForm() {
  const [token, setToken] = useState<string | null>();
  const [problem, setProblem] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<"sent" | "changed">();

  useEffect(() => setToken(new URLSearchParams(location.search).get("token")), []);

  async function ask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const email = String(new FormData(event.currentTarget).get("email"));
    setBusy(true);
    setProblem(undefined);
    try {
      const { error } = await authClient.requestPasswordReset({ email });
      if (error?.status === 429) return setProblem("That's too many tries for now. Wait a while, then try again.");
      // The site has no email set up (lib/auth.ts), which says nothing about the address.
      if (error?.status === 503) {
        return setProblem("This site can't send password reset emails yet. Ask one of its admins for help.");
      }
      if (error) return setProblem("That didn't work. Try again in a moment.");
      // The same whether or not the address has an account here, so nobody can find out which do.
      setDone("sent");
    } catch {
      setProblem("That didn't work. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  async function change(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const password = String(form.get("password"));
    const mismatch = passwordProblem(password, String(form.get("again")));
    if (mismatch) return setProblem(mismatch);
    setBusy(true);
    setProblem(undefined);
    try {
      const { error } = await authClient.resetPassword({ newPassword: password, token: token ?? "" });
      if (error) return setProblem("This link has already been used or has run out. Ask for a new one below.");
      setDone("changed");
    } catch {
      setProblem("That didn't work. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  if (token === undefined) return null;
  if (done === "sent") {
    return (
      <p>
        If that address has an account here, we've sent it a link to choose a new password. It works for 30 minutes.
      </p>
    );
  }
  if (done === "changed") {
    return (
      <p>
        Your password is changed, and you're signed out everywhere. <a href="/sign-in/">Sign in</a> with the new one.
      </p>
    );
  }
  if (token) {
    return (
      <form onSubmit={change} className="grid gap-4">
        <NewPasswordFields />
        {problem && <p role="alert">{problem}</p>}
        <button type="submit" disabled={busy} className="rounded bg-primary px-4 py-2 text-primary-foreground">
          {busy ? "Changing your password…" : "Change my password"}
        </button>
        <p>
          <a href="/reset-password/">Ask for a new link</a>
        </p>
      </form>
    );
  }
  return (
    <form onSubmit={ask} className="grid gap-4">
      <p>We'll email you a link to choose a new password.</p>
      <label className="grid gap-1">
        Email address
        <input name="email" type="email" autoComplete="email" required className="rounded border px-3 py-2" />
      </label>
      {problem && <p role="alert">{problem}</p>}
      <button type="submit" disabled={busy} className="rounded bg-primary px-4 py-2 text-primary-foreground">
        {busy ? "Sending…" : "Send me a link"}
      </button>
    </form>
  );
}
