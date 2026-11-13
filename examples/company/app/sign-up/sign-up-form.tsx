"use client";

import { type FormEvent, useEffect, useState } from "react";
import { NewPasswordFields, passwordProblem } from "@/app/reset-password/new-password-fields";
import { nextPath } from "@/app/sign-in/next-path";
import { authClient, TOO_MANY } from "@/lib/auth-client";

/**
 * Makes a reader's account, which can't sign in until the link emailed to its address has confirmed it. The answer
 * is the same whether or not the address already has an account, so the form never says which do.
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
    const password = String(form.get("password"));
    const wrong = passwordProblem(password, String(form.get("again")));
    if (wrong) return setProblem(wrong);
    const email = String(form.get("email")).trim();
    setBusy(true);
    setProblem(undefined);
    try {
      const { error } = await authClient.signUp.email({
        name: String(form.get("name")).trim(),
        email,
        password,
        // Where the confirmation's link signs them in to: the page they came from (lib/auth.ts keeps it on this site).
        callbackURL: nextPath(),
      });
      if (error?.status === 429) return setProblem(TOO_MANY);
      if (error?.status === 503) {
        return setProblem("This site can't send the email that confirms an address yet, so nobody can sign up.");
      }
      if (error?.status === 400) return setProblem(error.message ?? "Check what you've typed, then try again.");
      if (error) return setProblem("Signing up didn't work. Try again in a moment.");
      setSentTo(email);
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
          We've sent a link to {sentTo}. Follow it within 24 hours to confirm your address, which signs you in. If you
          already have an account here, no email comes: <a href={signIn}>sign in</a> instead, or{" "}
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
      <NewPasswordFields />
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
