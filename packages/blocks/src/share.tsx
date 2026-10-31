import { classNameField, cx, SiteLink, useParts, useSite, withParts } from "@goodfellow-cms/react";
import type { ComponentConfig } from "@puckeditor/core";
import { options, yesNo } from "./options.js";
import { DONATE_PARTS, SHARE_PARTS } from "./parts.js";
import {
  type DonateProps,
  givingNote,
  givingPage,
  pageAddress,
  SHARE_SITE_NAMES,
  SHARE_SITES,
  type ShareButtonsProps,
  shareLink,
  shownSites,
} from "./share-data.js";

export type { DonateProps, ShareButtonsProps, ShareSite } from "./share-data.js";

function Notice({ text, className }: { text: string; className: string }) {
  return (
    <p className={cx("rounded-md border border-dashed border-border p-4 text-muted-foreground", className)}>{text}</p>
  );
}

function ShareButtonsView({ label, sites, look, className, isEditing }: ShareButtonsProps & { isEditing: boolean }) {
  const { settings, path, pages, entry } = useSite();
  const part = useParts();
  const url = pageAddress(settings, path || "/");
  if (!url) {
    return isEditing ? (
      <Notice
        text="Sharing needs the Site address, in Site Settings, so the links can say where the page is."
        className={className}
      />
    ) : null;
  }
  const title =
    (entry?.content.fields.title as string | undefined) ||
    pages?.find((page) => page.path === path)?.title ||
    settings.title;
  const shown = shownSites(sites);
  if (shown.length === 0)
    return isEditing ? <Notice text="Choose where the page can be shared." className={className} /> : null;
  return (
    <div className={part("gf-share", "flex flex-wrap items-center gap-3", className)}>
      {label && <span className={part("gf-share-label", "font-medium")}>{label}</span>}
      <ul className={part("gf-share-list", "flex flex-wrap gap-2")}>
        {shown.map((site) => (
          <li key={site}>
            <SiteLink
              href={shareLink(site, url, title)}
              className={part(
                "gf-share-link",
                look === "links"
                  ? "text-primary underline underline-offset-4"
                  : "inline-flex h-9 items-center rounded-md border border-border px-3 text-sm font-medium hover:bg-accent hover:text-accent-foreground",
              )}
              {...(site !== "email" && { target: "_blank", rel: "noopener noreferrer" })}
            >
              {SHARE_SITE_NAMES[site]}
            </SiteLink>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Links that share the page on social sites or by email. They're only links, so the page loads nothing from those sites. */
export const ShareButtons: ComponentConfig<ShareButtonsProps> = withParts(
  {
    label: "Share buttons",
    fields: {
      label: { type: "text", label: "Words before the buttons" },
      sites: {
        type: "array",
        label: "Where it can be shared",
        arrayFields: { site: { type: "select", label: "Where", options: options(SHARE_SITE_NAMES) } },
        defaultItemProps: { site: "facebook" },
        getItemSummary: (item) => SHARE_SITE_NAMES[item.site] ?? "",
      },
      look: { type: "radio", label: "Look", options: options({ buttons: "Buttons", links: "Links" }) },
      className: classNameField,
    },
    defaultProps: {
      label: "Share this page",
      sites: SHARE_SITES.filter((site) => site !== "linkedin").map((site) => ({ site })),
      look: "buttons",
      className: "",
    },
    render: ({ puck, ...props }) => <ShareButtonsView {...props} isEditing={puck?.isEditing === true} />,
  },
  SHARE_PARTS,
);

function DonateView({
  heading,
  text,
  url,
  buttonLabel,
  showNote,
  align,
  className,
  isEditing,
}: DonateProps & { isEditing: boolean }) {
  const part = useParts();
  const page = givingPage(url);
  if (!page) {
    return isEditing ? (
      <Notice
        text={
          url.trim()
            ? "The giving page's address must start with https://, so visitors' card details are safe."
            : "Paste the address of your giving page, such as a Stripe payment link or a PayPal donate button's."
        }
        className={className}
      />
    ) : null;
  }
  const centered = align === "center";
  return (
    <div
      className={part(
        "gf-donate",
        cx("flex flex-col gap-3", centered ? "items-center text-center" : "items-start"),
        className,
      )}
    >
      {heading && <h2 className={part("gf-donate-heading", "font-heading text-2xl font-semibold")}>{heading}</h2>}
      {text && <p className={part("gf-donate-text", "max-w-prose text-muted-foreground")}>{text}</p>}
      <SiteLink
        href={page.url}
        className={part(
          "gf-donate-button",
          "inline-flex h-11 items-center justify-center rounded-md bg-primary px-6 font-medium text-primary-foreground transition hover:opacity-90",
        )}
        target="_blank"
        rel="noopener noreferrer"
      >
        {buttonLabel || "Give"}
      </SiteLink>
      {showNote && (
        <p className={part("gf-donate-note", "text-sm text-muted-foreground")}>{givingNote(page.service)}</p>
      )}
    </div>
  );
}

/**
 * A button to the site's giving page, such as a Stripe payment link. Payments
 * happen on the service's own page, so nothing about them reaches the site.
 */
export const Donate: ComponentConfig<DonateProps> = withParts(
  {
    label: "Donate button",
    fields: {
      heading: { type: "text", label: "Heading", contentEditable: true },
      text: { type: "textarea", label: "Text", contentEditable: true },
      url: { type: "text", label: "Giving page's address (a Stripe payment link, PayPal donate button or similar)" },
      buttonLabel: { type: "text", label: "Button's text", contentEditable: true },
      showNote: { type: "radio", label: "Say where people give", options: yesNo },
      align: { type: "radio", label: "Alignment", options: options({ left: "Left", center: "Center" }) },
      className: classNameField,
    },
    defaultProps: {
      heading: "Support our work",
      text: "",
      url: "",
      buttonLabel: "Give",
      showNote: true,
      align: "center",
      className: "",
    },
    render: ({ puck, ...props }) => <DonateView {...props} isEditing={puck?.isEditing === true} />,
  },
  DONATE_PARTS,
);
