"use client";

import { type FormEvent, useEffect, useState } from "react";
import { NewPasswordFields, passwordProblem } from "@/app/reset-password/new-password-fields";

/**
 * The setup code given in the address's fragment (`/setup/#code=…`), as the setup page's link gives it: browsers never
 * send a fragment, and the page takes it out of the address and its history entry at once.
 */
export function codeFromFragment(hash: string): string {
  const code = new URLSearchParams(hash.replace(/^#/, "")).get("code") ?? "";
  return /^[A-Z2-7]{4}(-[A-Z2-7]{4}){5}$/.test(code) ? code : "";
}

/** The setup code, the first admin's details, and a password typed twice, which the API checks again. */
export function SetupForm() {
  const [problem, setProblem] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [code, setCode] = useState("");

  useEffect(() => {
    if (!window.location.hash) return;
    setCode(codeFromFragment(window.location.hash));
    window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
  }, []);

  async function setUp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const password = String(form.get("password"));
    const mismatch = passwordProblem(password, String(form.get("again")));
    if (mismatch) return setProblem(mismatch);
    setBusy(true);
    setProblem(undefined);
    try {
      const response = await fetch("/api/setup/", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          code: String(form.get("code")),
          email: String(form.get("email")),
          name: String(form.get("name")),
          password,
        }),
      });
      if (response.ok) return setDone(true);
      const { error } = (await response.json().catch(() => ({}))) as { error?: string };
      setProblem(error ?? "That didn't work. Try again in a moment.");
    } catch {
      setProblem("That didn't work. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <p>
        You're the site's first admin. <a href="/sign-in/?next=%2Faccount%2F">Sign in</a>, then turn on two-factor
        sign-in on your account page straight away: until you do, you can edit pages but not change Site Settings or
        invite editors.
      </p>
    );
  }
  return (
    <form onSubmit={setUp} className="grid gap-4">
      <label className="grid gap-1">
        Setup code
        <input
          name="code"
          autoComplete="off"
          spellCheck={false}
          required
          value={code}
          onChange={(event) => setCode(event.target.value)}
          className="rounded border px-3 py-2 font-mono"
        />
      </label>
      <label className="grid gap-1">
        Your email address
        <input name="email" type="email" autoComplete="email" required className="rounded border px-3 py-2" />
      </label>
      <label className="grid gap-1">
        Your name
        <input name="name" autoComplete="name" required maxLength={100} className="rounded border px-3 py-2" />
      </label>
      <NewPasswordFields />
      {problem && <p role="alert">{problem}</p>}
      <button type="submit" disabled={busy} className="rounded bg-primary px-4 py-2 text-primary-foreground">
        {busy ? "Setting the site up…" : "Make me the admin"}
      </button>
    </form>
  );
}
