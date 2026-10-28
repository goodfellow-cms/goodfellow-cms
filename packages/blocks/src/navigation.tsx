import { type PageTree, pageTree } from "@goodfellow-cms/core";
import { classNameField, SiteImage, SiteLink, useParts, useSite, withParts } from "@goodfellow-cms/react";
import type { ComponentConfig } from "@puckeditor/core";
import { isCurrentLink } from "./links.js";
import { options, yesNo } from "./options.js";
import { MENU_PARTS, PAGE_LIST_PARTS, SITE_BRAND_PARTS } from "./parts.js";

export interface MenuProps {
  menu: string;
  orientation: "horizontal" | "vertical";
  className: string;
}

/**
 * Shows one of the site's menus (edited in Site Settings → Menus). Submenus open
 * on hover or keyboard focus, without JavaScript. The current page's link, and
 * the section it's in, have `data-current`; renderers that share one header
 * between pages, such as a Next.js layout, set it in the browser
 * (`data-gf-menu` marks the menu for them).
 */
function MenuView({ menu, orientation, className }: MenuProps) {
  const { menus, path } = useSite();
  const part = useParts();
  const items = menus[menu] ?? [];
  if (items.length === 0) return null;

  const vertical = orientation === "vertical";
  const linkClass = part(
    "gf-menu-link",
    "block rounded-md px-3 py-2 hover:bg-accent hover:text-accent-foreground data-current:font-semibold",
  );

  return (
    <nav aria-label={menu} className={part("gf-menu", undefined, className)} data-gf-menu="">
      <ul className={part("gf-menu-list", "flex gap-1", vertical ? "flex-col" : "flex-wrap items-center")}>
        {items.map((item) => (
          <li key={`${item.label}-${item.href}`} className={part("gf-menu-item", "group relative")}>
            <SiteLink
              href={item.href}
              className={linkClass}
              data-current={isCurrentLink(item.href, path) ? "" : undefined}
              aria-current={item.href === path ? "page" : undefined}
            >
              {item.label}
            </SiteLink>
            {item.children && item.children.length > 0 && (
              <ul
                className={part(
                  "gf-menu-submenu",
                  vertical
                    ? "ml-4 flex flex-col"
                    : "invisible absolute left-0 top-full z-10 min-w-48 rounded-md border bg-background p-1 opacity-0 shadow-md transition group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100",
                )}
              >
                {item.children.map((child) => (
                  <li key={`${child.label}-${child.href}`} className={part("gf-menu-item")}>
                    <SiteLink
                      href={child.href}
                      className={linkClass}
                      data-current={isCurrentLink(child.href, path) ? "" : undefined}
                      aria-current={child.href === path ? "page" : undefined}
                    >
                      {child.label}
                    </SiteLink>
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>
    </nav>
  );
}

export const Menu: ComponentConfig<MenuProps> = withParts(
  {
    label: "Menu",
    fields: {
      menu: { type: "text", label: "Menu name" },
      orientation: { type: "radio", label: "Layout", options: options({ horizontal: "Across", vertical: "Down" }) },
      className: classNameField,
    },
    defaultProps: { menu: "main", orientation: "horizontal", className: "" },
    render: (props) => <MenuView {...props} />,
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
