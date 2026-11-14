// Amounts as Stripe gives them, in a currency's smallest unit, by Stripe's own rules rather than the currency's, which
// differ for a few (https://docs.stripe.com/currencies#zero-decimal). No imports, since the Payments page's browser
// code uses it.

/** Currencies Stripe gives in whole units. */
const ZERO_DECIMAL = new Set([
  "bif",
  "clp",
  "djf",
  "gnf",
  "jpy",
  "kmf",
  "krw",
  "mga",
  "pyg",
  "rwf",
  "vnd",
  "vuv",
  "xaf",
  "xof",
  "xpf",
]);

/** Currencies Stripe gives in thousandths. */
const THREE_DECIMAL = new Set(["bhd", "jod", "kwd", "omr", "tnd"]);

/**
 * An amount Stripe gave, in `currency`'s units: every other currency, ISK and UGX among them (whole krónur and
 * shillings, which Stripe still gives in hundredths), is in hundredths.
 */
export function stripeAmount(amount: number, currency: string): number {
  const code = currency.toLowerCase();
  if (ZERO_DECIMAL.has(code)) return amount;
  if (THREE_DECIMAL.has(code)) return amount / 1000;
  return amount / 100;
}

/** An amount Stripe gave, written as the person's browser writes `currency`. */
export function stripeMoney(amount: number, currency: string, locale?: string): string {
  const units = stripeAmount(amount, currency);
  try {
    return new Intl.NumberFormat(locale, { style: "currency", currency }).format(units);
  } catch {
    return `${units} ${currency.toUpperCase()}`;
  }
}
