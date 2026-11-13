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
      label: "Stripe price (only the site's owners can change it)",
      placeholder: "price_…",
      metadata: { owners: true },
    },
    className: classNameField,
  },
  defaultProps: { label: "Subscribe", price: "", className: "" },
  render: (props) => <BuyButtonView {...props} id={String(props.id)} />,
};

/** The form, or, without a price, a note in the editor and nothing on the site. */
function BuyButtonView({ id, label, price, className }: BuyButtonProps & { id: string }) {
  const { path, base, adminLink } = useSite();
  if (!PRICE_ID.test(price ?? "")) {
    // Only the editor gives `adminLink`, so this shows there alone; on the site, the button isn't there.
    return adminLink ? (
      <p className={cx("rounded-md border border-dashed border-border p-4 text-muted-foreground", className)}>
        A site owner chooses this button's Stripe price before it's shown on the site.
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
