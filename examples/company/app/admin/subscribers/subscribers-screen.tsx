"use client";

import { type FormEvent, useCallback, useEffect, useState } from "react";

interface ShownSubscription {
  until: string | null;
  byHand: boolean;
}

interface Subscriber {
  id: string;
  email: string;
  name: string;
  role: string;
  confirmed: boolean;
  subscriptions: ShownSubscription[];
}

/** Calls the subscribers API, giving its words for what went wrong. */
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

/** A subscription in words: until when, and whether it was paid for or given by hand. */
function described(subscription: ShownSubscription): string {
  const until = subscription.until
    ? `until ${new Date(subscription.until).toLocaleDateString(undefined, { dateStyle: "long", timeZone: "UTC" })}`
    : "with no end";
  return `${subscription.byHand ? "Given" : "Paid"}, ${until}`;
}

/** The site's readers, who subscribes, giving or taking away a subscription, and removing a reader: admins' own. */
export function SubscribersScreen() {
  const [subscribers, setSubscribers] = useState<Subscriber[]>();
  const [problem, setProblem] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const answer = await call<{ subscribers: Subscriber[] }>("/api/subscribers/");
      setSubscribers(answer?.subscribers ?? []);
    } catch (error) {
      setProblem((error as Error).message);
    }
  }, []);
  useEffect(() => void load(), [load]);

  /** Runs a change, then shows what it did and the list again. */
  async function act(work: () => Promise<string>) {
    setBusy(true);
    setProblem(undefined);
    setNotice(undefined);
    try {
      setNotice(await work());
      await load();
    } catch (error) {
      setProblem((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function give(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = Object.fromEntries(new FormData(form));
    void act(async () => {
      await call("/api/subscribers/", { method: "POST", body: JSON.stringify(data) });
      form.reset();
      return `${String(data.email)} subscribes now.`;
    });
  }

  if (problem && !subscribers) return <p role="alert">{problem}</p>;
  if (!subscribers) return <p>Loading…</p>;
  return (
    <div className="grid gap-8">
      <p>
        Readers sign up from the site to subscribe. A subscription someone paid for ends when it ends in the payment
        service; one you give here lasts until the day you choose, or until you take it away.
      </p>
      {notice && <p role="status">{notice}</p>}
      {problem && <p role="alert">{problem}</p>}
      {subscribers.length === 0 ? (
        <p>Nobody has signed up yet.</p>
      ) : (
        <table className="w-full text-left">
          <thead>
            <tr>
              <th scope="col">Name</th>
              <th scope="col">Email address</th>
              <th scope="col">Subscription</th>
              <th scope="col">
                <span className="sr-only">Changes</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {subscribers.map((subscriber) => (
              <tr key={subscriber.id}>
                <td>
                  {subscriber.name}
                  {!subscriber.confirmed && " (hasn't confirmed their address)"}
                  {subscriber.role !== "member" && ` (${subscriber.role === "admin" ? "an admin" : "an editor"})`}
                </td>
                <td>{subscriber.email}</td>
                <td>
                  {subscriber.subscriptions.length === 0
                    ? "None"
                    : subscriber.subscriptions.map((subscription) => described(subscription)).join("; ")}
                </td>
                <td className="flex gap-2">
                  {subscriber.subscriptions.some((subscription) => subscription.byHand) && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        void act(async () => {
                          await call(`/api/subscribers/${encodeURIComponent(subscriber.id)}/subscription/`, {
                            method: "DELETE",
                          });
                          return `The subscription you gave ${subscriber.name} has been taken away. Members' pages can show for up to 10 more minutes.`;
                        })
                      }
                    >
                      Take away the subscription you gave
                    </button>
                  )}
                  {subscriber.role === "member" && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        if (!confirm(`Remove ${subscriber.name}'s account? They won't be able to sign in any more.`)) {
                          return;
                        }
                        void act(async () => {
                          await call(`/api/subscribers/${encodeURIComponent(subscriber.id)}/`, { method: "DELETE" });
                          return `${subscriber.name}'s account has been removed.`;
                        });
                      }}
                    >
                      Remove
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <form onSubmit={give} className="grid gap-4">
        <h2 className="text-xl font-semibold">Give someone a subscription</h2>
        <p>They need an account first: readers sign up from the site, and editors and admins already have one.</p>
        <label className="grid gap-1">
          Their account's email address
          <input name="email" type="email" required className="rounded border px-3 py-2" />
        </label>
        <label className="grid gap-1">
          Until (leave it empty for no end)
          <input name="until" type="date" className="rounded border px-3 py-2" />
        </label>
        <button type="submit" disabled={busy} className="rounded bg-primary px-4 py-2 text-primary-foreground">
          {busy ? "Giving…" : "Give the subscription"}
        </button>
      </form>
    </div>
  );
}
