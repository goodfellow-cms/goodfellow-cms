"use client";

import { type FormEvent, useCallback, useEffect, useState } from "react";

interface SiteEditor {
  id: string;
  email: string;
  name: string;
  role: "admin" | "editor";
  joined: boolean;
}

type Invited = { sent: true } | { sent: false; link: string };

/** Calls the editors API, giving its words for what went wrong. */
async function call<T>(path: string, init?: RequestInit): Promise<T | undefined> {
  const response = await fetch(path, {
    ...init,
    headers: init?.body ? { "content-type": "application/json" } : undefined,
  });
  if (response.status === 204) return undefined;
  const body = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) throw new Error(body.error ?? "Something went wrong. Try again in a moment.");
  return body;
}

/** Who has an account, inviting someone, and changing or removing them: the site's admins' own screen. */
export function EditorsScreen() {
  const [editors, setEditors] = useState<SiteEditor[]>();
  const [problem, setProblem] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [link, setLink] = useState<string>();
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const answer = await call<{ editors: SiteEditor[] }>("/api/editors/");
      setEditors(answer?.editors ?? []);
    } catch (error) {
      setProblem((error as Error).message);
    }
  }, []);
  useEffect(() => void load(), [load]);

  /** Runs a change, then shows what it did and the list again. */
  async function act(work: () => Promise<string | undefined>) {
    setBusy(true);
    setProblem(undefined);
    setNotice(undefined);
    setLink(undefined);
    try {
      setNotice(await work());
      await load();
    } catch (error) {
      setProblem((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  /** Says what an invitation did, or hands over its link where the site can't send email. */
  function invited(answer: Invited | undefined, email: string): string {
    if (answer && !answer.sent) {
      setLink(answer.link);
      return `The site can't send email yet, so send ${email} this link yourself. It works once, for 48 hours.`;
    }
    return `We've emailed ${email} a link to choose a password. It works once, for 48 hours.`;
  }

  function invite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = Object.fromEntries(new FormData(form));
    void act(async () => {
      const answer = await call<Invited>("/api/editors/", { method: "POST", body: JSON.stringify(data) });
      form.reset();
      return invited(answer, String(data.email));
    });
  }

  if (problem && !editors) return <p role="alert">{problem}</p>;
  if (!editors) return <p>Loading…</p>;
  return (
    <div className="grid gap-8">
      {notice && <p role="status">{notice}</p>}
      {link && (
        <p>
          <input readOnly value={link} aria-label="Invitation link" className="w-full rounded border px-3 py-2" />
        </p>
      )}
      {problem && <p role="alert">{problem}</p>}
      <table className="w-full text-left">
        <thead>
          <tr>
            <th scope="col">Name</th>
            <th scope="col">Email address</th>
            <th scope="col">Can</th>
            <th scope="col">
              <span className="sr-only">Changes</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {editors.map((editor) => (
            <tr key={editor.id}>
              <td>
                {editor.name}
                {!editor.joined && " (invited)"}
              </td>
              <td>{editor.email}</td>
              <td>
                <select
                  aria-label={`What ${editor.name} can do`}
                  value={editor.role}
                  disabled={busy}
                  onChange={(event) => {
                    const role = event.target.value;
                    void act(async () => {
                      await call(`/api/editors/${encodeURIComponent(editor.id)}/`, {
                        method: "PATCH",
                        body: JSON.stringify({ role }),
                      });
                      return `${editor.name} is now ${role === "admin" ? "an admin" : "an editor"}.`;
                    });
                  }}
                >
                  <option value="editor">Edit pages</option>
                  <option value="admin">Edit everything, and manage editors</option>
                </select>
              </td>
              <td className="flex gap-2">
                {!editor.joined && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      void act(async () =>
                        invited(
                          await call<Invited>(`/api/editors/${encodeURIComponent(editor.id)}/invitation/`, {
                            method: "POST",
                          }),
                          editor.email,
                        ),
                      )
                    }
                  >
                    Send the invitation again
                  </button>
                )}
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    if (!confirm(`Remove ${editor.name}? They won't be able to sign in any more.`)) return;
                    void act(async () => {
                      await call(`/api/editors/${encodeURIComponent(editor.id)}/`, { method: "DELETE" });
                      return `${editor.name} can't sign in any more.`;
                    });
                  }}
                >
                  Remove
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <form onSubmit={invite} className="grid gap-4">
        <h2 className="text-xl font-semibold">Invite someone</h2>
        <label className="grid gap-1">
          Name
          <input name="name" required maxLength={100} className="rounded border px-3 py-2" />
        </label>
        <label className="grid gap-1">
          Email address
          <input name="email" type="email" required className="rounded border px-3 py-2" />
        </label>
        <label className="grid gap-1">
          They can
          <select name="role" defaultValue="editor" className="rounded border px-3 py-2">
            <option value="editor">Edit pages</option>
            <option value="admin">Edit everything, and manage editors</option>
          </select>
        </label>
        <button type="submit" disabled={busy} className="rounded bg-primary px-4 py-2 text-primary-foreground">
          {busy ? "Inviting…" : "Send the invitation"}
        </button>
      </form>
    </div>
  );
}
