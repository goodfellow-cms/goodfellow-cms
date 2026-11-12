import { classNameField, cx, SiteLink, useSite } from "@goodfellow-cms/react";
import type { ComponentConfig } from "@puckeditor/core";

export interface PaywallProps {
  heading: string;
  text: string;
  subscribeLabel: string;
  subscribeHref: string;
  signInLabel: string;
  className: string;
}

/** What a paywall says where an editor leaves its words out, as on items' pages, whose template places none. */
export const PAYWALL_DEFAULTS: PaywallProps = {
  heading: "The rest is for subscribers",
  text: "Subscribe to read the whole page.",
  subscribeLabel: "Subscribe",
  subscribeHref: "",
  signInLabel: "Already subscribe? Sign in",
  className: "",
};

/** The block's name in the site's `blocks`, which `goodfellowPages()` is given as its `paywall` (lib/site.ts). */
export const PAYWALL_BLOCK = "Paywall";

/**
 * Where a page for members only stops for everyone else: they see the blocks
 * above it, then this, and members see the whole page without it. Pages for
 * everyone never show it. The server picks which version to send (proxy.ts),
 * so this is plain HTML, the same for everyone who sees it.
 */
export const Paywall: ComponentConfig<PaywallProps> = {
  label: "Paywall",
  fields: {
    heading: { type: "text", label: "Heading", contentEditable: true },
    text: { type: "textarea", label: "Message", contentEditable: true },
    subscribeLabel: { type: "text", label: "Subscribe button's words" },
    subscribeHref: { type: "text", label: "Where people subscribe", placeholder: "/subscribe" },
    signInLabel: { type: "text", label: "Sign-in link's words" },
    className: classNameField,
  },
  defaultProps: PAYWALL_DEFAULTS,
  render: (props) => {
    const { path } = useSite();
    const shown = { ...PAYWALL_DEFAULTS, ...definedProps(props) };
    const signIn = `/sign-in/?${new URLSearchParams({ next: path ?? "/" })}`;
    return (
      <section
        className={cx(
          "mx-auto my-8 max-w-2xl rounded-lg border border-border bg-muted p-6 text-center text-foreground",
          shown.className,
        )}
      >
        {shown.heading && <h2 className="font-heading text-2xl font-semibold">{shown.heading}</h2>}
        {shown.text && <p className="mt-2 text-muted-foreground">{shown.text}</p>}
        <div className="mt-4 flex flex-wrap items-center justify-center gap-4">
          {shown.subscribeHref && shown.subscribeLabel && (
            <SiteLink
              href={shown.subscribeHref}
              className="rounded-md bg-primary px-4 py-2 font-medium text-primary-foreground"
            >
              {shown.subscribeLabel}
            </SiteLink>
          )}
          {shown.signInLabel && (
            <SiteLink href={signIn} className="font-medium text-primary underline">
              {shown.signInLabel}
            </SiteLink>
          )}
        </div>
      </section>
    );
  },
};

/** The props a paywall's data has, without those it leaves out, so the defaults fill them in. */
function definedProps(props: Partial<PaywallProps>): Partial<PaywallProps> {
  return Object.fromEntries(Object.entries(props).filter(([, value]) => typeof value === "string"));
}
