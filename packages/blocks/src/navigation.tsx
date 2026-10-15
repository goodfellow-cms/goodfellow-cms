import { classNameField, cx, SiteImage, SiteLink, useSite } from "@goodfellow-cms/react";
import type { ComponentConfig } from "@puckeditor/core";
import { options } from "./options.js";

export interface MenuProps {
  menu: string;
  orientation: "horizontal" | "vertical";
  className: string;
}

function isCurrent(href: string, path: string): boolean {
  return href === path || (href !== "/" && path.startsWith(`${href}/`));
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
  const items = menus[menu] ?? [];
  if (items.length === 0) return null;

  const vertical = orientation === "vertical";
  const linkClass =
    "block rounded-md px-3 py-2 hover:bg-accent hover:text-accent-foreground data-current:font-semibold";

  return (
    <nav aria-label={menu} className={className || undefined} data-gf-menu="">
      <ul className={cx("flex", vertical ? "flex-col gap-1" : "flex-wrap items-center gap-1")}>
        {items.map((item) => (
          <li key={`${item.label}-${item.href}`} className="group relative">
            <SiteLink
              href={item.href}
              className={linkClass}
              data-current={isCurrent(item.href, path) ? "" : undefined}
              aria-current={item.href === path ? "page" : undefined}
            >
              {item.label}
            </SiteLink>
            {item.children && item.children.length > 0 && (
              <ul
                className={cx(
                  vertical
                    ? "ml-4 flex flex-col"
                    : "invisible absolute left-0 top-full z-10 min-w-48 rounded-md border bg-background p-1 opacity-0 shadow-md transition group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100",
                )}
              >
                {item.children.map((child) => (
                  <li key={`${child.label}-${child.href}`}>
                    <SiteLink
                      href={child.href}
                      className={linkClass}
                      data-current={isCurrent(child.href, path) ? "" : undefined}
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

export const Menu: ComponentConfig<MenuProps> = {
  label: "Menu",
  fields: {
    menu: { type: "text", label: "Menu name" },
    orientation: { type: "radio", label: "Layout", options: options({ horizontal: "Across", vertical: "Down" }) },
    className: classNameField,
  },
  defaultProps: { menu: "main", orientation: "horizontal", className: "" },
  render: (props) => <MenuView {...props} />,
};

export interface SiteBrandProps {
  show: "both" | "logo" | "title";
  className: string;
}

/** The site's logo and/or title (from Site Settings), linking to the home page. */
function SiteBrandView({ show, className }: SiteBrandProps) {
  const { settings } = useSite();
  const logo = show !== "title" ? settings.logo : undefined;
  const showTitle = show !== "logo" || !logo;
  const alt = showTitle ? "" : logo?.alt || settings.title;
  const dark = settings.theme.darkMode ? logo?.darkSrc : undefined;

  return (
    <SiteLink href="/" className={cx("inline-flex items-center gap-3 font-heading text-xl font-bold", className)}>
      {logo && dark ? (
        <>
          {/* The dark logo in dark mode, the usual one otherwise; dark: applies only where the site has dark mode. */}
          <SiteImage src={logo.src} alt={alt} className="h-10 w-auto dark:hidden" />
          <SiteImage src={dark} alt={alt} className="hidden h-10 w-auto dark:block" />
        </>
      ) : (
        logo && <SiteImage src={logo.src} alt={alt} className="h-10 w-auto" />
      )}
      {showTitle && <span>{settings.title}</span>}
    </SiteLink>
  );
}

export const SiteBrand: ComponentConfig<SiteBrandProps> = {
  label: "Site name and logo",
  fields: {
    show: {
      type: "radio",
      label: "Show",
      options: options({ both: "Logo and name", logo: "Logo only", title: "Name only" }),
    },
    className: classNameField,
  },
  defaultProps: { show: "both", className: "" },
  render: (props) => <SiteBrandView {...props} />,
};
