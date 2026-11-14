import { withBase } from "@goodfellow-cms/core";
import { classNameField, cx, useSite } from "@goodfellow-cms/react";
import type { ComponentConfig } from "@puckeditor/core";

export interface BuyButtonProps {
  label: string;
  price: string;
  className: string;
}

/** The block's name in the site's `blocks`, which checkout looks for on the page a button's form names (lib/site.ts). */
export const BUY_BUTTON_BLOCK = "BuyButton";

/** A Stripe price's id, as a Buy button holds one. */
export const PRICE_ID = /^price_[A-Za-z0-9]+$/;

/**
 * A button that sells something through Stripe Checkout (lib/stripe.ts): a subscription, for a price that repeats,
 * or something bought once. It's a plain form that names the page and the button, never the price: the server reads
 * the price the site's owners gave this button from the page as it's published, so nobody can choose their own.
 * Only owners can change the price (`metadata: { owners: true }`, which the site's server holds editors to), since
 * an editor who could would choose what's sold, and for how much. Without one, it isn't shown on the site.
 */
export const BuyButton: ComponentConfig<BuyButtonProps> = {
  label: "Buy button",
  fields: {
    label: { type: "text", label: "Button's words", contentEditable: true },
    price: {
      type: "text",
      label: "Stripe price ID: price_…, copied from the price in Stripe (only the site's owners can change it)",
      placeholder: "price_…",
      metadata: { owners: true },
    },
    className: classNameField,
  },
  defaultProps: { label: "Subscribe", price: "", className: "" },
  render: (props) => <BuyButtonView {...props} id={String(props.id)} />,
};

/**
 * What the editor says of a price that isn't a Stripe price's id, if anything: none at all, or something else, such as
 * a product's id (`prod_…`) or the amount, which owners put there most often. Whether Stripe has a price with the id is
 * for the server to ask, on the Payments page, since the editor has no key.
 */
export function priceNote(price: string): string | undefined {
  if (PRICE_ID.test(price)) return undefined;
  const where =
    "In Stripe, open the product (Product catalog), then its price, and copy its ID, which starts with price_.";
  if (!price.trim()) return `A site owner puts a Stripe price ID in this button's settings before it's shown. ${where}`;
  if (price.trim().startsWith("prod_")) {
    return `That's a product's ID, not a price's, so the button isn't shown on the site. ${where}`;
  }
  return `"${price}" isn't a Stripe price ID, so the button isn't shown on the site. ${where}`;
}

/** The form, or, without a price, a note in the editor and nothing on the site. */
function BuyButtonView({ id, label, price, className }: BuyButtonProps & { id: string }) {
  const { path, base, adminLink } = useSite();
  const note = priceNote(price ?? "");
  if (note) {
    // Only the editor gives `adminLink`, so this shows there alone; on the site, the button isn't there.
    return adminLink ? (
      <p className={cx("rounded-md border border-dashed border-border p-4 text-muted-foreground", className)}>
        {note} Owners can check every button's price with Stripe on the Payments page, /admin/payments/.
      </p>
    ) : null;
  }
  return (
    <form method="post" action={withBase("/api/checkout/", base)} className={cx("my-4", className)}>
      <input type="hidden" name="page" value={path ?? "/"} />
      <input type="hidden" name="block" value={String(id)} />
      <button type="submit" className="rounded-md bg-primary px-4 py-2 font-medium text-primary-foreground">
        {label || "Subscribe"}
      </button>
    </form>
  );
}
