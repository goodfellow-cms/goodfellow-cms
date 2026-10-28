import { type PageTree, pageTree } from "@goodfellow-cms/core";
import { classNameField, SiteImage, SiteLink, useParts, useSite, withParts } from "@goodfellow-cms/react";
import type { ComponentConfig } from "@puckeditor/core";
import { hasSubmenus, isCurrentLink, type MenuButton, subpageLinks } from "./links.js";
import { options, yesNo } from "./options.js";
import { MENU_PARTS, PAGE_LIST_PARTS, SITE_BRAND_PARTS } from "./parts.js";

export interface MenuProps {
  menu: string;
  orientation: "horizontal" | "vertical";
  /** The menu's colors: like the page, or a bar of a theme color, its submenus see-through in it. Stored blocks may predate it. */
  colors?: "page" | "primary" | "secondary";
  /** Shows the pages under each submenu link's page as another level. Stored blocks may predate it. */
  subpages?: boolean;
  /** When the links are behind a menu button (☰) instead: never, below a breakpoint, or always. Stored blocks may predate it. */
  menuButton?: MenuButton;
  /** The menu button's name, for screen readers. Stored blocks may predate it. */
  buttonLabel?: string;
  className: string;
}

/** Where the menu button and the links show, for each choice, written out so Tailwind finds them. */
const MENU_BUTTON: Record<MenuButton, { toggle: string; list: string }> = {
  never: { toggle: "hidden", list: "" },
  sm: { toggle: "sm:hidden", list: "max-sm:hidden" },
  md: { toggle: "md:hidden", list: "max-md:hidden" },
  lg: { toggle: "lg:hidden", list: "max-lg:hidden" },
  always: { toggle: "", list: "hidden" },
};

/** What the editor says about a menu across the page whose submenus phones can't open. */
export const MENU_BUTTON_NOTICE =
  "This menu's submenus open when the pointer is over them, which phones and tablets don't have, so their links can't be reached there. Choose when to show the menu button (☰) to show every link on them.";

/** Each of the menu's colors' classes, written out so Tailwind finds them. */
const MENU_COLORS = {
  page: {
    menu: "",
    link: "hover:bg-accent hover:text-accent-foreground",
    submenu: "border bg-background text-foreground shadow-md",
    sublink: "hover:bg-accent hover:text-accent-foreground",
  },
  primary: {
    menu: "bg-primary text-primary-foreground",
    link: "hover:bg-primary-foreground/10",
    submenu: "bg-primary/90 text-primary-foreground shadow-lg backdrop-blur-sm",
    sublink: "hover:bg-secondary hover:text-secondary-foreground data-current:bg-secondary/70",
  },
  secondary: {
    menu: "bg-secondary text-secondary-foreground",
    link: "hover:bg-secondary-foreground/10",
    submenu: "bg-secondary/90 text-secondary-foreground shadow-lg backdrop-blur-sm",
    sublink: "hover:bg-primary hover:text-primary-foreground data-current:bg-primary/70",
  },
} as const;

/**
 * Shows one of the site's menus (edited in Site Settings → Menus). Submenus open
 * on hover or keyboard focus, without JavaScript; those near the menu's right
 * end open leftwards, so they stay on the page. With `subpages`, a submenu
 * link to a page with pages under it opens them as another level. With
 * `menuButton`, a button (☰, a `<details>`, so it needs no JavaScript either)
 * shows every link, every level of them, in a panel below it instead, below
 * the breakpoint chosen or always. The current page's link, and the section
 * it's in, have `data-current`; renderers that share one header between pages,
 * such as a Next.js layout, set it in the browser (`data-gf-menu` marks the
 * menu for them) and close the panel after each navigation.
 */
function MenuView({
  menu,
  orientation,
  colors = "page",
  subpages = false,
  menuButton = "never",
  buttonLabel,
  className,
  isEditing = false,
}: MenuProps & { isEditing?: boolean }) {
  const { menus, path, pages } = useSite();
  const part = useParts();
  const items = menus[menu] ?? [];
  if (items.length === 0) return null;

  const vertical = orientation === "vertical";
  const look = MENU_COLORS[colors] ?? MENU_COLORS.page;
  const shown = MENU_BUTTON[menuButton] ?? MENU_BUTTON.never;
  const linkClass = part("gf-menu-link", ["block rounded-md px-3 py-2", look.link, "data-current:font-semibold"]);
  const sublinkClass = part("gf-menu-link", ["block rounded-md px-3 py-2", look.sublink, "data-current:font-semibold"]);
  // A submenu link with pages under it, beside the arrow that says so.
  const parentLinkClass = part("gf-menu-link", [
    "flex items-center gap-4 rounded-md px-3 py-2",
    look.sublink,
    "data-current:font-semibold",
  ]);
  const current = (href: string) => ({
    "data-current": isCurrentLink(href, path) ? "" : undefined,
    "aria-current": href === path ? ("page" as const) : undefined,
  });
  const unreachable = isEditing && !vertical && menuButton === "never" && hasSubmenus(items);

  return (
    <nav aria-label={menu} className={part("gf-menu", look.menu, className)} data-gf-menu="">
      {unreachable && (
        <p className="mb-2 rounded-md border border-dashed border-border p-3 text-sm text-muted-foreground">
          {MENU_BUTTON_NOTICE}
        </p>
      )}
      {menuButton !== "never" && (
        <details className={part("gf-menu-toggle", "group/menu relative", shown.toggle)}>
          <summary
            className={part("gf-menu-button", [
              "flex cursor-pointer list-none items-center rounded-md p-2 [&::-webkit-details-marker]:hidden",
              look.link,
            ])}
          >
            <svg
              aria-hidden="true"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              className="size-6 group-open/menu:hidden"
            >
              <path d="M4 6h16M4 12h16M4 18h16" />
            </svg>
            <svg
              aria-hidden="true"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              className="hidden size-6 group-open/menu:block"
            >
              <path d="M6 6l12 12M18 6 6 18" />
            </svg>
            <span className="sr-only">{buttonLabel?.trim() || "Menu"}</span>
          </summary>
          <div
            className={part("gf-menu-panel", [
              "absolute right-0 top-full z-20 mt-2 w-72 max-w-[calc(100vw-2rem)] rounded-md p-2",
              look.submenu,
            ])}
          >
            {/* Every level, one under another, since a tap can't open a submenu. */}
            <ul className={part("gf-menu-list", "flex flex-col gap-1")}>
              {items.map((item) => (
                <li key={`${item.label}-${item.href}`} className={part("gf-menu-item")}>
                  <SiteLink href={item.href} className={sublinkClass} {...current(item.href)}>
                    {item.label}
                  </SiteLink>
                  {item.children && item.children.length > 0 && (
                    <ul className={part("gf-menu-submenu", "ml-4 flex flex-col gap-1")}>
                      {item.children.map((child) => {
                        const under = subpages ? subpageLinks(child.href, pages) : [];
                        return (
                          <li key={`${child.label}-${child.href}`} className={part("gf-menu-item")}>
                            <SiteLink href={child.href} className={sublinkClass} {...current(child.href)}>
                              {child.label}
                            </SiteLink>
                            {under.length > 0 && (
                              <ul className={part("gf-menu-submenu", "ml-4 flex flex-col gap-1")}>
                                {under.map((page) => (
                                  <li key={page.href} className={part("gf-menu-item")}>
                                    <SiteLink href={page.href} className={sublinkClass} {...current(page.href)}>
                                      {page.label}
                                    </SiteLink>
                                  </li>
                                ))}
                              </ul>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
          </div>
        </details>
      )}
      {menuButton !== "always" && (
        <ul
          className={part("gf-menu-list", ["flex gap-1", vertical ? "flex-col" : "flex-wrap items-center"], shown.list)}
        >
          {items.map((item, index) => {
            // On the menu's right half, the pages under submenu links open leftwards.
            const opensLeft = index >= Math.floor(items.length / 2);
            return (
              <li key={`${item.label}-${item.href}`} className={part("gf-menu-item", "group relative")}>
                <SiteLink href={item.href} className={linkClass} {...current(item.href)}>
                  {item.label}
                </SiteLink>
                {item.children && item.children.length > 0 && (
                  <ul
                    className={part(
                      "gf-menu-submenu",
                      vertical
                        ? "ml-4 flex flex-col"
                        : [
                            "invisible absolute top-full z-10 min-w-48 rounded-md p-1 opacity-0 transition group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100",
                            look.submenu,
                            index === items.length - 1 ? "right-0" : "left-0",
                          ],
                    )}
                  >
                    {item.children.map((child) => {
                      const under = subpages ? subpageLinks(child.href, pages) : [];
                      return (
                        <li
                          key={`${child.label}-${child.href}`}
                          className={part("gf-menu-item", under.length > 0 && "group/sub relative")}
                        >
                          <SiteLink
                            href={child.href}
                            className={vertical ? linkClass : under.length > 0 ? parentLinkClass : sublinkClass}
                            {...current(child.href)}
                          >
                            {!vertical && opensLeft && under.length > 0 && <span aria-hidden="true">‹</span>}
                            <span className="flex-1">{child.label}</span>
                            {!vertical && !opensLeft && under.length > 0 && <span aria-hidden="true">›</span>}
                          </SiteLink>
                          {under.length > 0 && (
                            <ul
                              className={part(
                                "gf-menu-submenu",
                                vertical
                                  ? "ml-4 flex flex-col"
                                  : [
                                      "invisible absolute top-0 z-10 min-w-48 rounded-md p-1 opacity-0 transition group-hover/sub:visible group-hover/sub:opacity-100 group-focus-within/sub:visible group-focus-within/sub:opacity-100",
                                      look.submenu,
                                      opensLeft ? "right-full" : "left-full",
                                    ],
                              )}
                            >
                              {under.map((page) => (
                                <li key={page.href} className={part("gf-menu-item")}>
                                  <SiteLink
                                    href={page.href}
                                    className={vertical ? linkClass : sublinkClass}
                                    {...current(page.href)}
                                  >
                                    {page.label}
                                  </SiteLink>
                                </li>
                              ))}
                            </ul>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </nav>
  );
}

export const Menu: ComponentConfig<MenuProps> = withParts(
  {
    label: "Menu",
    fields: {
      menu: { type: "text", label: "Menu name" },
      orientation: { type: "radio", label: "Layout", options: options({ horizontal: "Across", vertical: "Down" }) },
      colors: {
        type: "radio",
        label: "Colors",
        options: options({ page: "Like the page", primary: "Primary", secondary: "Secondary" }),
      },
      subpages: { type: "radio", label: "Show the pages under each submenu link", options: yesNo },
      menuButton: {
        type: "select",
        label: "Show the links behind a menu button (☰)",
        options: options({
          never: "Never",
          sm: "On phones",
          md: "On phones and small tablets",
          lg: "On phones and tablets",
          always: "Always",
        }),
      },
      buttonLabel: { type: "text", label: "Menu button's name, for screen readers" },
      className: classNameField,
    },
    defaultProps: {
      menu: "main",
      orientation: "horizontal",
      colors: "page",
      subpages: false,
      menuButton: "never",
      buttonLabel: "Menu",
      className: "",
    },
    render: ({ puck, ...props }) => <MenuView {...props} isEditing={puck.isEditing} />,
  },
  MENU_PARTS,
);

export interface SiteBrandProps {
  show: "both" | "logo" | "title";
  /** Shows the site's description from Site Settings under its name. Stored blocks may predate it. */
  tagline?: boolean;
  className: string;
}

/** The site's logo and/or title (from Site Settings), linking to the home page. */
function SiteBrandView({ show, tagline, className }: SiteBrandProps) {
  const { settings, home = "/" } = useSite();
  const part = useParts();
  const logo = show !== "title" ? settings.logo : undefined;
  const showTitle = show !== "logo" || !logo;
  const alt = showTitle ? "" : logo?.alt || settings.title;
  // Beside the site's name, the logo adds nothing for people who can't see it.
  const decorative = showTitle || undefined;
  const dark = settings.theme.darkMode ? logo?.darkSrc : undefined;

  return (
    <SiteLink
      href={home}
      className={part("gf-site-brand", "inline-flex items-center gap-3 font-heading text-xl font-bold", className)}
    >
      {logo && dark ? (
        <>
          {/* The dark logo in dark mode, the usual one otherwise; dark: applies only where the site has dark mode. */}
          <SiteImage
            src={logo.src}
            alt={alt}
            aria-hidden={decorative}
            className={part("gf-site-brand-logo", "h-10 w-auto", "dark:hidden")}
          />
          <SiteImage
            src={dark}
            alt={alt}
            aria-hidden={decorative}
            className={part("gf-site-brand-logo", "h-10 w-auto", "hidden dark:block")}
          />
        </>
      ) : (
        logo && (
          <SiteImage
            src={logo.src}
            alt={alt}
            aria-hidden={decorative}
            className={part("gf-site-brand-logo", "h-10 w-auto")}
          />
        )
      )}
      {showTitle &&
        (tagline && settings.description ? (
          <span className={part("gf-site-brand-text", "flex flex-col")}>
            <span className={part("gf-site-brand-name")}>{settings.title}</span>
            <span className={part("gf-site-brand-tagline", "font-body text-sm font-normal text-muted-foreground")}>
              {settings.description}
            </span>
          </span>
        ) : (
          <span className={part("gf-site-brand-name")}>{settings.title}</span>
        ))}
    </SiteLink>
  );
}

export const SiteBrand: ComponentConfig<SiteBrandProps> = withParts(
  {
    label: "Site name and logo",
    fields: {
      show: {
        type: "radio",
        label: "Show",
        options: options({ both: "Logo and name", logo: "Logo only", title: "Name only" }),
      },
      tagline: { type: "radio", label: "Site description under the name", options: yesNo },
      className: classNameField,
    },
    defaultProps: { show: "both", tagline: false, className: "" },
    render: (props) => <SiteBrandView {...props} />,
  },
  SITE_BRAND_PARTS,
);

export interface PageListProps {
  /** Only the pages under this address, such as `/about`; every page without it. */
  parent: string;
  className: string;
}

function PageListItems({
  pages,
  path,
  nested,
  className,
}: {
  pages: PageTree[];
  path: string;
  nested: boolean;
  className?: string;
}) {
  const part = useParts();
  return (
    <ul
      className={
        nested
          ? part("gf-page-list-children", "ml-4 mt-1 flex flex-col gap-1")
          : part("gf-page-list", "flex flex-col gap-1", className)
      }
    >
      {pages.map((page) => (
        <li key={page.path} className={part("gf-page-list-item")}>
          <SiteLink
            href={page.path}
            aria-current={page.path === path ? "page" : undefined}
            className={part("gf-page-list-link", "hover:underline", page.path === path && "font-semibold")}
          >
            {page.title}
          </SiteLink>
          {page.children.length > 0 && <PageListItems pages={page.children} path={path} nested />}
        </li>
      ))}
    </ul>
  );
}

function PageListView({ parent, className }: PageListProps) {
  const { pages = [], path } = useSite();
  const tree = pageTree(pages, parent.trim() || "/");
  if (tree.length === 0) return null;
  return <PageListItems pages={tree} path={path} nested={false} className={className} />;
}

/** A list of the site's pages, nested by their addresses, as WordPress's Page List block shows them. */
export const PageList: ComponentConfig<PageListProps> = withParts(
  {
    label: "Page list",
    fields: {
      parent: { type: "text", label: "Only pages under this address (empty for every page)" },
      className: classNameField,
    },
    defaultProps: { parent: "", className: "" },
    render: (props) => <PageListView {...props} />,
  },
  PAGE_LIST_PARTS,
);
