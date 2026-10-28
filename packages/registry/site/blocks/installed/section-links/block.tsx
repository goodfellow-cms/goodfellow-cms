import { pageTree } from "@goodfellow-cms/core";
import { classNameField, SiteLink, useParts, useSite, withParts } from "@goodfellow-cms/react";
import type { ComponentConfig, Slot } from "@puckeditor/core";

export interface SectionLinksProps {
  content: Slot;
  menu: string;
  section: string;
  side: "right" | "left";
  className: string;
}

interface MenuLink {
  label: string;
  href: string;
  children?: MenuLink[];
}

/** Whether `href` is the page at `path`, or a section it's in. */
function isCurrent(href: string, path: string): boolean {
  if (!href.startsWith("/")) return false;
  return href === "/" ? path === "/" : path === href || path.startsWith(`${href}/`);
}

/**
 * The page's own blocks, with links beside them to the other pages in its part of the menu: the
 * top-level item it's under, and that item's submenu. On a page under one of those, such as one
 * ministry under "Ministries", the pages beside it instead. On a collection item's page, it can
 * show the links as if on another page, such as the list of news.
 */
const SectionLinks: ComponentConfig<SectionLinksProps> = withParts(
  {
    label: "Content with section links",
    fields: {
      content: { type: "slot" },
      menu: { type: "text", label: "Menu the links come from" },
      section: {
        type: "text",
        label: "Show the links as if on this page (leave empty for the page itself)",
        placeholder: "/news",
      },
      side: {
        type: "radio",
        label: "Links' side",
        options: [
          { value: "right", label: "Right" },
          { value: "left", label: "Left" },
        ],
      },
      className: classNameField,
    },
    defaultProps: { content: [], menu: "main", section: "", side: "right", className: "" },
    render: ({ content: Content, menu, section, side, className }) => {
      const { menus, path, pages = [] } = useSite();
      const part = useParts();
      const at = section.trim() || path;
      const top = ((menus[menu] ?? []) as MenuLink[]).find(
        (item) => isCurrent(item.href, at) || item.children?.some((child) => isCurrent(child.href, at)),
      );
      const parent = top?.children?.find((child) => at.startsWith(`${child.href}/`));
      // The pages directly under the submenu page the page is under, such as one ministry's.
      const subpages = parent && parent.href !== "/" ? pageTree(pages, parent.href) : [];
      const links =
        parent && subpages.length > 0
          ? subpages.map((page) => ({ label: page.title, href: page.path }))
          : (top?.children ?? []).map((child) => ({ label: child.label, href: child.href }));
      return (
        <div
          className={part(
            "gf-section-links",
            [
              "grid items-start gap-10",
              side === "left" ? "md:grid-cols-[16rem_minmax(0,1fr)]" : "md:grid-cols-[minmax(0,1fr)_16rem]",
            ],
            className,
          )}
        >
          <Content className={part("gf-section-links-content", ["min-w-0", side === "left" && "md:order-2"])} />
          {links.length > 0 && (
            <nav
              aria-label={parent?.label ?? top?.label ?? menu}
              className={side === "left" ? "md:order-1" : undefined}
            >
              <ul
                className={part(
                  "gf-section-links-list",
                  "divide-y divide-primary-foreground/20 overflow-hidden rounded-md bg-primary text-primary-foreground shadow-md",
                )}
              >
                {links.map((link) => {
                  const current = link.href === at || (link.href !== "/" && path.startsWith(`${link.href}/`));
                  return (
                    <li key={`${link.label}-${link.href}`}>
                      <SiteLink
                        href={link.href}
                        aria-current={link.href === path ? "page" : undefined}
                        data-current={current ? "" : undefined}
                        className={part(
                          "gf-section-links-link",
                          "block px-4 py-3 hover:bg-secondary hover:text-secondary-foreground data-current:bg-secondary data-current:text-secondary-foreground",
                        )}
                      >
                        {link.label}
                      </SiteLink>
                    </li>
                  );
                })}
              </ul>
            </nav>
          )}
        </div>
      );
    },
  },
  {
    "gf-section-links": "Layout",
    "gf-section-links-content": "Content",
    "gf-section-links-list": "Links",
    "gf-section-links-link": "Link",
  },
);

export default SectionLinks;
