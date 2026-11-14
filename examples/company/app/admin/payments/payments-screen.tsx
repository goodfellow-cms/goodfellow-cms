"use client";

import { useEffect, useState } from "react";
import type { PaymentsOverview } from "@/lib/payments";
import { checkWords } from "@/lib/price-words";

type ListedButton = PaymentsOverview["buttons"][number];

/** What a setting payments need is called, and where an owner sets it (README.md's "Payments"). */
const SETTINGS: { key: keyof PaymentsOverview["setUp"]; name: string; where: string }[] = [
  {
    key: "address",
    name: "The site's address",
    where: "GOODFELLOW_SITE_URL, set when the site was put online.",
  },
  {
    key: "key",
    name: "Stripe's key",
    where:
      "STRIPE_SECRET_KEY, a GitHub secret the Deploy workflow gives the site, or a secret in Cloudflare's dashboard.",
  },
  {
    key: "webhook",
    name: "Stripe's webhook",
    where: "STRIPE_WEBHOOK_SECRET, set the same way, with the webhook's signing secret from Stripe.",
  },
];

/**
 * Each button with a key of its own: where it is, numbered where that's the same as another's, since a synced block
 * placed twice gives two buttons one id on one page.
 */
function rowKeys(buttons: ListedButton[]): [ListedButton, string][] {
  const seen = new Map<string, number>();
  return buttons.map((button) => {
    const place = `${button.part}:${button.page}:${button.block}`;
    const count = (seen.get(place) ?? 0) + 1;
    seen.set(place, count);
    return [button, count === 1 ? place : `${place}#${count}`];
  });
}

/** Where a button is, in words. */
function placeWords(button: ListedButton): string {
  if (button.part === "page") return button.page;
  return `The ${button.part}${button.page === "/" ? "" : ` (${button.page})`}, on every page`;
}

/** The site's settings for payments, and every Buy button with what Stripe says of its price: owners' own. */
export function PaymentsScreen() {
  const [overview, setOverview] = useState<PaymentsOverview>();
  const [problem, setProblem] = useState<string>();

  useEffect(() => {
    void (async () => {
      try {
        const response = await fetch("/api/payments/");
        const body = (await response.json().catch(() => ({}))) as PaymentsOverview & { error?: string };
        if (!response.ok) throw new Error(body.error ?? "Something went wrong. Try again in a moment.");
        setOverview(body);
      } catch (error) {
        setProblem((error as Error).message);
      }
    })();
  }, []);

  if (problem) return <p role="alert">{problem}</p>;
  if (!overview) return <p>Loading…</p>;
  return (
    <div className="grid gap-8">
      <section className="grid gap-2">
        <h2 className="text-xl font-semibold">Settings</h2>
        <ul className="grid gap-1">
          {SETTINGS.map((setting) => (
            <li key={setting.key}>
              {overview.setUp[setting.key] ? "✓" : "✗"} {setting.name}:{" "}
              {overview.setUp[setting.key] ? "set." : `not set. ${setting.where}`}
            </li>
          ))}
        </ul>
        {overview.setUp.key && (
          <p>
            {overview.testMode
              ? "The key is a test mode key: payments take no real money, and only test mode prices work."
              : "The key is a live key: payments take real money, and only live mode prices work."}
          </p>
        )}
      </section>
      <section className="grid gap-2">
        <h2 className="text-xl font-semibold">Buy buttons</h2>
        <p>
          Every Buy button on the published site. Only the site's owners can change a button's price, in the editor.
        </p>
        {overview.buttons.length === 0 ? (
          <p>The site has no Buy buttons. Add one to a page in the editor.</p>
        ) : (
          <table className="w-full text-left">
            <thead>
              <tr>
                <th>Where</th>
                <th>Button</th>
                <th>Stripe price</th>
                <th>What Stripe says</th>
              </tr>
            </thead>
            <tbody>
              {rowKeys(overview.buttons).map(([button, key]) => {
                const { words, problem: wrong } = checkWords(button.check);
                return (
                  <tr key={key}>
                    <td>{placeWords(button)}</td>
                    <td>{button.label || "Subscribe"}</td>
                    <td>
                      <code>{button.price || "None"}</code>
                    </td>
                    <td className={wrong ? "text-destructive" : undefined}>{words}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
