"use client";

import { type FormEvent, useState } from "react";
import { authClient } from "@/lib/auth-client";
import { QrCode } from "./qr-code";

/** What turning on two-factor sign-in gave: the authenticator app's address and backup codes, shown once. */
interface Setup {
  uri: string;
  key: string;
  backupCodes: string[];
}

const RETRY = "That didn't work. Check your connection and try again.";

/** Someone's own account: who they are, and turning two-factor sign-in on and off. */
export function AccountScreen() {
  const { data: session, isPending } = authClient.useSession();
  // What this page has just changed, since the session may be read from its cookie's copy for a few minutes.
  const [changed, setChanged] = useState<boolean>();
  const [setup, setSetup] = useState<Setup>();
  const [problem, setProblem] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [busy, setBusy] = useState(false);

  /** Runs a step, showing what went wrong. */
  async function step(work: () => Promise<string | undefined>) {
    setBusy(true);
    setProblem(undefined);
    setNotice(undefined);
    try {
      const failed = await work();
      if (failed) setProblem(failed);
    } catch {
      setProblem(RETRY);
    } finally {
      setBusy(false);
    }
  }

  function start(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const password = String(new FormData(event.currentTarget).get("password"));
    void step(async () => {
      const { data, error } = await authClient.twoFactor.enable({ password, method: "totp" });
      if (error?.status === 429) return "That's too many tries for now. Wait a few minutes, then try again.";
      if (error || !data) return "That isn't your password.";
      if (data.method !== "totp") return RETRY;
      setSetup({
        uri: data.totpURI,
        key: new URL(data.totpURI).searchParams.get("secret") ?? "",
        backupCodes: data.backupCodes,
      });
    });
  }

  function confirm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const code = String(new FormData(event.currentTarget).get("code")).replace(/\s/g, "");
    void step(async () => {
      const { error } = await authClient.twoFactor.verifyTotp({ code });
      if (error?.status === 429) return "That's too many tries for now. Wait a few minutes, then try again.";
      if (error) return "That code didn't work. Check the time on your phone is right, then try the next code.";
      setSetup(undefined);
      setChanged(true);
      setNotice("Two-factor sign-in is on. You'll need a code from your app each time you sign in.");
    });
  }

  function stop(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const password = String(new FormData(event.currentTarget).get("password"));
    void step(async () => {
      const { error } = await authClient.twoFactor.disable({ password });
      if (error?.status === 429) return "That's too many tries for now. Wait a few minutes, then try again.";
      if (error) return "That isn't your password.";
      setChanged(false);
      setNotice("Two-factor sign-in is off.");
    });
  }

  if (isPending) return <p>Loading…</p>;
  if (!session) {
    return (
      <p>
        <a href="/sign-in/?next=/account/">Sign in</a> to see your account.
      </p>
    );
  }
  const { user } = session;
  const on = changed ?? Boolean((user as { twoFactorEnabled?: boolean | null }).twoFactorEnabled);
  const admin = (user as { role?: string | null }).role === "admin";
  return (
    <div className="grid gap-8">
      <p>
        Signed in as {user.name} ({user.email}).
      </p>
      {notice && <p role="status">{notice}</p>}
      <section className="grid gap-4">
        <h2 className="text-xl font-semibold">Two-factor sign-in</h2>
        <p>
          Asks for a code from an authenticator app on your phone, such as Google Authenticator or 1Password, after your
          password, so someone who learns your password still can't sign in as you.
          {admin && " As an admin, you need it to change Site Settings and manage editors."}
        </p>
        {problem && <p role="alert">{problem}</p>}
        {on && !setup && (
          <form onSubmit={stop} className="grid gap-4">
            <p>It's on.</p>
            <label className="grid gap-1">
              Your password
              <input
                name="password"
                type="password"
                autoComplete="current-password"
                required
                className="rounded border px-3 py-2"
              />
            </label>
            <button type="submit" disabled={busy} className="rounded border px-4 py-2">
              Turn it off
            </button>
          </form>
        )}
        {!on && !setup && (
          <form onSubmit={start} className="grid gap-4">
            <label className="grid gap-1">
              Your password
              <input
                name="password"
                type="password"
                autoComplete="current-password"
                required
                className="rounded border px-3 py-2"
              />
            </label>
            <button type="submit" disabled={busy} className="rounded bg-primary px-4 py-2 text-primary-foreground">
              Turn on two-factor sign-in
            </button>
          </form>
        )}
        {setup && (
          <div className="grid gap-4">
            <ol className="grid list-decimal gap-4 pl-6">
              <li>
                <p>In your authenticator app, add an account by scanning this code:</p>
                <QrCode text={setup.uri} label="The code for your authenticator app" />
                <p>
                  Or type in this key: <code>{setup.key}</code>
                </p>
              </li>
              <li>
                <p>
                  Keep these backup codes somewhere safe, such as a password manager. Each one signs you in once if you
                  lose your phone. They won't be shown again.
                </p>
                <ul className="font-mono">
                  {setup.backupCodes.map((code) => (
                    <li key={code}>{code}</li>
                  ))}
                </ul>
              </li>
              <li>
                <form onSubmit={confirm} className="grid gap-4">
                  <label className="grid gap-1">
                    The code your app shows now
                    <input
                      name="code"
                      autoComplete="one-time-code"
                      inputMode="numeric"
                      required
                      className="rounded border px-3 py-2"
                    />
                  </label>
                  <button
                    type="submit"
                    disabled={busy}
                    className="rounded bg-primary px-4 py-2 text-primary-foreground"
                  >
                    Turn it on
                  </button>
                </form>
              </li>
            </ol>
          </div>
        )}
      </section>
    </div>
  );
}
