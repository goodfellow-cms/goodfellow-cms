"use client";

import { useEffect, useState } from "react";
import type { PaymentsOverview, PriceCheck } from "@/lib/payments";

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

/** An amount in a currency, as the person's browser writes it. */
function money(amount: number, currency: string): string {
  try {
    // Stripe gives amounts in the currency's smallest unit, which Intl knows the size of.
    const digits = new Intl.NumberFormat(undefined, { style: "currency", currency }).resolvedOptions()
      .maximumFractionDigits;
    return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(amount / 10 ** (digits ?? 2));
  } catch {
    return `${amount} ${currency.toUpperCase()}`;
  }
}

/** What Stripe says of a button's price, in words, and whether it's a problem to fix. */
export function checkWords(check: PriceCheck | undefined): { words: string; problem: boolean } {
  if (!check) return { words: "Not checked: set Stripe's key first.", problem: true };
  switch (check.state) {
    case "on-sale": {
      const amount = check.amount === null ? "an amount the buyer chooses" : money(check.amount, check.currency);
      const every = check.interval
        ? check.interval.every === 1
          ? ` a ${check.interval.unit}`
          : ` every ${check.interval.every} ${check.interval.unit}s`
        : "";
      const what = check.subscription ? `A subscription, ${amount}${every}` : `Bought once, ${amount}`;
      return { words: `${what}${check.name ? ` (${check.name})` : ""}.`, problem: false };
    }
    case "not-a-price":
      return {
        words:
          "No price yet, so the button isn't shown. Put the id of a price in Stripe, price_…, in its Stripe price.",
        problem: true,
      };
    case "missing":
      return {
        words:
          "Stripe has no price with this id. Check it's copied whole, and that it's from the same mode, test or live, as the site's key.",
        problem: true,
      };
    case "not-on-sale":
      return {
        words: "This price is archived in Stripe, so the button says it isn't on sale. Choose a price that's active.",
        problem: true,
      };
    case "unchecked":
      return {
        words:
          check.reason === "key"
            ? "Stripe refused the site's key. Check it's the restricted key README.md describes, with Prices: Read."
            : "Stripe couldn't be asked just now. Try again in a moment.",
        problem: true,
      };
  }
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
              {overview.buttons.map((button) => {
                const { words, problem: wrong } = checkWords(button.check);
                return (
                  <tr key={`${button.part}:${button.page}:${button.block}`}>
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
