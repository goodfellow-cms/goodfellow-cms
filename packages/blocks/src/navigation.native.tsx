import { type MenuItem, type PageTree, pageTree } from "@goodfellow-cms/core";
import { NativeImage, NativeLink, OnColor, SiteText, TEXT, useNativeSite, useWide } from "@goodfellow-cms/expo";
import { useState } from "react";
import { Pressable, View } from "react-native";
import { isCurrentLink, subpageLinks } from "./links.js";
import type { MenuProps, PageListProps, SiteBrandProps } from "./navigation.js";

function MenuLinks({
  items,
  path,
  depth = 0,
  subpages = false,
}: {
  items: MenuItem[];
  path: string;
  depth?: number;
  subpages?: boolean;
}) {
  const { theme, pages } = useNativeSite();
  const { colors, radius } = theme;
  return (
    <View style={{ gap: 2, marginLeft: depth * 16 }}>
      {items.map((item) => {
        const current = isCurrentLink(item.href, path);
        return (
          <View key={`${item.label}-${item.href}`}>
            <NativeLink href={item.href} style={{ borderRadius: radius, paddingHorizontal: 12, paddingVertical: 10 }}>
              <SiteText style={{ fontWeight: current ? "600" : "400", color: colors.foreground }}>
                {item.label}
              </SiteText>
            </NativeLink>
            {item.children && item.children.length > 0 ? (
              <MenuLinks items={item.children} path={path} depth={depth + 1} subpages={subpages} />
            ) : (
              // A submenu link's own pages, as the website's menu shows them.
              subpages &&
              depth === 1 && <MenuLinks items={subpageLinks(item.href, pages)} path={path} depth={depth + 1} />
            )}
          </View>
        );
      })}
    </View>
  );
}

/**
 * One of the site's menus. Down the screen, it's a list; across, it's a row
 * on wider screens and a button that opens the list on phones.
 */
export function Menu({ menu, orientation, colors = "page", subpages = false }: MenuProps) {
  const site = useNativeSite();
  if (colors === "page") return <MenuShown menu={menu} orientation={orientation} subpages={subpages} />;
  // A bar of a theme color, its text in the color that goes on it.
  const background = site.theme.colors[colors];
  const foreground = site.theme.colors[colors === "primary" ? "primaryForeground" : "secondaryForeground"];
  return (
    <View style={{ backgroundColor: background }}>
      <OnColor foreground={foreground}>
        <MenuShown menu={menu} orientation={orientation} subpages={subpages} />
      </OnColor>
    </View>
  );
}

function MenuShown({ menu, orientation, subpages }: Pick<MenuProps, "menu" | "orientation" | "subpages">) {
  const { menus, path, theme } = useNativeSite();
  const wide = useWide("md");
  const [open, setOpen] = useState(false);
  const items = menus[menu] ?? [];
  if (items.length === 0) return null;
  if (orientation === "vertical") return <MenuLinks items={items} path={path} subpages={subpages} />;
  if (wide) {
    return (
      <View accessibilityRole="menubar" style={{ flexDirection: "row", flexWrap: "wrap", gap: 4 }}>
        {items.map((item) => (
          <NativeLink
            key={`${item.label}-${item.href}`}
            href={item.href}
            style={{ paddingHorizontal: 12, paddingVertical: 8 }}
          >
            <SiteText style={{ fontWeight: isCurrentLink(item.href, path) ? "600" : "400" }}>{item.label}</SiteText>
          </NativeLink>
        ))}
      </View>
    );
  }
  return (
    <View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={menu}
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen(!open)}
        style={{ alignSelf: "flex-start", padding: 8, borderRadius: theme.radius }}
      >
        <SiteText style={{ fontSize: TEXT.xl }}>{open ? "✕" : "☰"}</SiteText>
      </Pressable>
      {open && <MenuLinks items={items} path={path} subpages={subpages} />}
    </View>
  );
}

/** The site's logo and name, linking to the home page. */
export function SiteBrand({ show, tagline }: SiteBrandProps) {
  const { settings, home, theme } = useNativeSite();
  const logo = show !== "title" ? settings.logo : undefined;
  const showTitle = show !== "logo" || !logo;
  const src = theme.dark && logo?.darkSrc ? logo.darkSrc : logo?.src;
  return (
    <NativeLink
      href={home}
      label={settings.title}
      style={{ flexDirection: "row", alignItems: "center", gap: 12, alignSelf: "flex-start" }}
    >
      {src ? (
        <NativeImage
          src={src}
          alt={showTitle ? "" : logo?.alt || settings.title}
          aspect="auto"
          rounded={false}
          style={{ height: 40, width: "auto", minWidth: 40, backgroundColor: "transparent" }}
        />
      ) : null}
      {showTitle ? (
        <View>
          <SiteText style={{ fontFamily: theme.fonts.heading, fontSize: TEXT.xl, fontWeight: "700" }}>
            {settings.title}
          </SiteText>
          {tagline && settings.description ? (
            <SiteText muted style={{ fontSize: TEXT.sm }}>
              {settings.description}
            </SiteText>
          ) : null}
        </View>
      ) : null}
    </NativeLink>
  );
}

function PageListItems({ pages, path, depth }: { pages: PageTree[]; path: string; depth: number }) {
  return (
    <View style={{ gap: 4, marginLeft: depth * 16 }}>
      {pages.map((page) => (
        <View key={page.path} style={{ gap: 4 }}>
          <NativeLink href={page.path}>
            <SiteText style={{ fontWeight: page.path === path ? "600" : "400" }}>{page.title}</SiteText>
          </NativeLink>
          {page.children.length > 0 && <PageListItems pages={page.children} path={path} depth={depth + 1} />}
        </View>
      ))}
    </View>
  );
}

/** A list of the site's pages, nested by their addresses. */
export function PageList({ parent }: PageListProps) {
  const { pages, path } = useNativeSite();
  const tree = pageTree(pages, parent.trim() || "/");
  if (tree.length === 0) return null;
  return <PageListItems pages={tree} path={path} depth={0} />;
}
