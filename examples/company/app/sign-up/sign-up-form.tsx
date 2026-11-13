"use client";

import { type FormEvent, useEffect, useState } from "react";
import { nextPath } from "@/app/sign-in/next-path";

/**
 * Asks for a reader's account, whose password is chosen from the link emailed to its address (lib/sign-up.ts). The
 * answer is the same whether or not the address already has an account, so the form never says which do.
 */
export function SignUpForm() {
  const [problem, setProblem] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [sentTo, setSentTo] = useState<string>();
  const [signIn, setSignIn] = useState("/sign-in/");
  useEffect(() => setSignIn(`/sign-in/${location.search}`), []);

  async function signUp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const email = String(form.get("email")).trim();
    setBusy(true);
    setProblem(undefined);
    try {
      const response = await fetch("/api/sign-up/", {
        method: "POST",
        headers: { "content-type": "application/json" },
        // Where to go once the password is chosen: the page they came from (lib/sign-up.ts keeps it on this site).
        body: JSON.stringify({ name: String(form.get("name")), email, next: nextPath() }),
      });
      if (response.ok) return setSentTo(email);
      const { error } = (await response.json().catch(() => ({}))) as { error?: string };
      setProblem(error ?? "Signing up didn't work. Try again in a moment.");
    } catch {
      setProblem("Signing up didn't work. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  if (sentTo) {
    return (
      <div className="grid gap-4" role="status">
        <p>
          We've sent a link to {sentTo}. Follow it within 24 hours to choose your password. If you already have an
          account here, no email comes: <a href={signIn}>sign in</a> instead, or{" "}
          <a href="/reset-password/">choose a new password</a>.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={signUp} className="grid gap-4">
      <label className="grid gap-1">
        Your name
        <input name="name" autoComplete="name" required maxLength={100} className="rounded border px-3 py-2" />
      </label>
      <label className="grid gap-1">
        Email address
        <input name="email" type="email" autoComplete="email" required className="rounded border px-3 py-2" />
      </label>
      {problem && <p role="alert">{problem}</p>}
      <button type="submit" disabled={busy} className="rounded bg-primary px-4 py-2 text-primary-foreground">
        {busy ? "Signing up…" : "Sign up"}
      </button>
      <p>
        Already have an account? <a href={signIn}>Sign in</a>
      </p>
    </form>
  );
}
