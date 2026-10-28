import { classNameField, SiteLink, useParts, withParts } from "@goodfellow-cms/react";
import type { ComponentConfig } from "@puckeditor/core";

type Network = "facebook" | "instagram" | "youtube" | "x";

interface SocialLink {
  network: Network;
  href: string;
}

export interface SocialLinksProps {
  links: SocialLink[];
  size: "sm" | "md" | "lg";
  className: string;
}

const names: Record<Network, string> = { facebook: "Facebook", instagram: "Instagram", youtube: "YouTube", x: "X" };

/** Each network's mark, drawn in the text's color on a 24 by 24 grid. */
const paths: Record<Network, string> = {
  facebook:
    "M24 12.07C24 5.41 18.63 0 12 0S0 5.4 0 12.07C0 18.1 4.39 23.1 10.13 24v-8.44H7.08v-3.49h3.04V9.41c0-3.02 1.8-4.7 4.54-4.7 1.31 0 2.68.24 2.68.24v2.97h-1.5c-1.5 0-1.96.93-1.96 1.89v2.26h3.32l-.53 3.5h-2.8V24C19.62 23.1 24 18.1 24 12.07",
  instagram:
    "M12 2.16c3.2 0 3.58.01 4.85.07 3.25.15 4.77 1.69 4.92 4.92.06 1.27.07 1.65.07 4.85s-.01 3.58-.07 4.85c-.15 3.23-1.66 4.77-4.92 4.92-1.27.06-1.65.07-4.85.07s-3.58-.01-4.85-.07c-3.26-.15-4.77-1.7-4.92-4.92C2.17 15.58 2.16 15.2 2.16 12s.01-3.58.07-4.85C2.38 3.92 3.9 2.38 7.15 2.23 8.42 2.17 8.8 2.16 12 2.16M12 0C8.74 0 8.33.01 7.05.07 2.7.27.27 2.69.07 7.05.01 8.33 0 8.74 0 12s.01 3.67.07 4.95c.2 4.36 2.62 6.78 6.98 6.98C8.33 23.99 8.74 24 12 24s3.67-.01 4.95-.07c4.35-.2 6.78-2.62 6.98-6.98.06-1.28.07-1.69.07-4.95s-.01-3.67-.07-4.95c-.2-4.35-2.62-6.78-6.98-6.98C15.67.01 15.26 0 12 0m0 5.84a6.16 6.16 0 1 0 0 12.32 6.16 6.16 0 0 0 0-12.32M12 16a4 4 0 1 1 0-8 4 4 0 0 1 0 8m6.4-11.85a1.44 1.44 0 1 0 0 2.88 1.44 1.44 0 0 0 0-2.88",
  youtube:
    "M23.5 6.19a3.02 3.02 0 0 0-2.12-2.14C19.5 3.55 12 3.55 12 3.55s-7.5 0-9.38.5A3.02 3.02 0 0 0 .5 6.19C0 8.07 0 12 0 12s0 3.93.5 5.81a3.02 3.02 0 0 0 2.12 2.14c1.88.5 9.38.5 9.38.5s7.5 0 9.38-.5a3.02 3.02 0 0 0 2.12-2.14C24 15.93 24 12 24 12s0-3.93-.5-5.81M9.55 15.57V8.43L15.82 12z",
  x: "M18.9 1.15h3.68l-8.04 9.19L24 22.85h-7.4l-5.8-7.58-6.63 7.58H.48l8.6-9.83L0 1.15h7.59l5.24 6.93zm-1.29 19.5h2.04L6.48 3.24H4.3z",
};

const sizeClasses: Record<SocialLinksProps["size"], string> = { sm: "size-5", md: "size-6", lg: "size-8" };

/** Links to the site's pages on social networks, each shown as the network's mark, in the text's color. */
const SocialLinks: ComponentConfig<SocialLinksProps> = withParts(
  {
    label: "Social links",
    fields: {
      links: {
        type: "array",
        label: "Links",
        arrayFields: {
          network: {
            type: "select",
            label: "Network",
            options: (Object.keys(names) as Network[]).map((value) => ({ value, label: names[value] })),
          },
          href: { type: "text", label: "Address of the page", placeholder: "https://www.facebook.com/…" },
        },
        defaultItemProps: { network: "facebook", href: "" },
        getItemSummary: (link) => names[link.network] ?? "New link",
      },
      size: {
        type: "radio",
        label: "Size",
        options: [
          { value: "sm", label: "Small" },
          { value: "md", label: "Medium" },
          { value: "lg", label: "Large" },
        ],
      },
      className: classNameField,
    },
    defaultProps: { links: [], size: "md", className: "" },
    render: ({ links, size, className }) => {
      const part = useParts();
      return (
        <ul className={part("gf-social-links", "flex flex-wrap items-center gap-3", className)}>
          {links
            .filter((link) => link.href && paths[link.network])
            .map((link, index) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: links have no ids of their own
              <li key={index}>
                <SiteLink
                  href={link.href}
                  className={part("gf-social-links-link", "block opacity-90 transition-opacity hover:opacity-100")}
                >
                  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className={sizeClasses[size]}>
                    <path d={paths[link.network]} />
                  </svg>
                  <span className="sr-only">{names[link.network]}</span>
                </SiteLink>
              </li>
            ))}
        </ul>
      );
    },
  },
  { "gf-social-links": "Social links", "gf-social-links-link": "Link" },
);

export default SocialLinks;
