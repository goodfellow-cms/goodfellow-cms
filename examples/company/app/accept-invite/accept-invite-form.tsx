"use client";

import { type FormEvent, useState } from "react";
import { NewPasswordFields, passwordProblem } from "@/app/reset-password/new-password-fields";
import { nextPath } from "@/app/sign-in/next-path";

/**
 * Choosing a password with an invitation's link, or a sign-up's, which then stops working, then signing in: to edit,
 * after an invitation, or at the page a reader signed up from, which their link names.
 */
export function AcceptInviteForm() {
  const [problem, setProblem] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [signIn, setSignIn] = useState<string>();

  async function accept(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const password = String(form.get("password"));
    const mismatch = passwordProblem(password, String(form.get("again")));
    if (mismatch) return setProblem(mismatch);
    setBusy(true);
    setProblem(undefined);
    try {
      const token = new URLSearchParams(location.search).get("token") ?? "";
      const response = await fetch("/api/accept-invite/", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      if (response.ok) return setSignIn(`/sign-in/?next=${encodeURIComponent(nextPath("/admin/"))}`);
      const { error } = (await response.json().catch(() => ({}))) as { error?: string };
      setProblem(error ?? "That didn't work. Try again in a moment.");
    } catch {
      setProblem("That didn't work. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  if (signIn) {
    return (
      <p>
        Your password is set. <a href={signIn}>Sign in</a> with it.
      </p>
    );
  }
  return (
    <form onSubmit={accept} className="grid gap-4">
      <NewPasswordFields />
      {problem && <p role="alert">{problem}</p>}
      <button type="submit" disabled={busy} className="rounded bg-primary px-4 py-2 text-primary-foreground">
        {busy ? "Setting your password…" : "Set my password"}
      </button>
    </form>
  );
}
