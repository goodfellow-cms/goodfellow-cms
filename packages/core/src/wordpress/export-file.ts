/**
 * Reads a WordPress export file (WXR, from Tools → Export): the site's pages,
 * posts, categories, tags, menus and media library.
 */
import { hasBlocks, parseBlocks, type WordPressBlock } from "./blocks.js";
import { attribute, child, childElements, childText, type Element, parseXml, plainText, textOf } from "./html.js";
import {
  decodedSlug,
  type WordPressItem,
  type WordPressMedia,
  type WordPressMenu,
  type WordPressMenuItem,
  WordPressReadError,
  type WordPressSite,
  type WordPressTerm,
  wordPressDate,
} from "./model.js";

/** Kinds of WordPress content that are part of other things, rather than content of their own, so they aren't counted as left out. */
const PARTS = new Set([
  "attachment",
  "nav_menu_item",
  "wp_block",
  "wp_navigation",
  "revision",
  "customize_changeset",
  "oembed_cache",
  "custom_css",
  "user_request",
  "wp_global_styles",
  "wp_template",
  "wp_template_part",
  "wp_font_family",
  "wp_font_face",
]);

function meta(item: Element): Record<string, string> {
  const values: Record<string, string> = {};
  for (const entry of childElements(item).filter((element) => element.name === "wp:postmeta")) {
    values[childText(entry, "wp:meta_key")] = childText(entry, "wp:meta_value");
  }
  return values;
}

function number(text: string): number {
  const value = Number.parseInt(text, 10);
  return Number.isFinite(value) ? value : 0;
}

/** An item's categories and tags, by slug. */
function terms(item: Element, domain: string): string[] {
  return childElements(item)
    .filter((element) => element.name === "category" && attribute(element, "domain") === domain)
    .map((element) => decodedSlug(attribute(element, "nicename")))
    .filter(Boolean);
}

/** A block theme's menu, from its `wp:navigation-link` and `wp:navigation-submenu` blocks. */
function navigationMenu(name: string, slug: string, content: string): WordPressMenu {
  const items: WordPressMenuItem[] = [];
  let next = 1;
  const walk = (blocks: WordPressBlock[], parent: number) => {
    for (const block of blocks) {
      if (block.name !== "core/navigation-link" && block.name !== "core/navigation-submenu") {
        walk(block.innerBlocks, parent);
        continue;
      }
      const id = next++;
      const label = typeof block.attrs.label === "string" ? plainText(block.attrs.label) : "";
      const url = typeof block.attrs.url === "string" ? block.attrs.url : "";
      const target = typeof block.attrs.id === "number" ? block.attrs.id : undefined;
      const kind = block.attrs.kind === "taxonomy" ? (block.attrs.type === "tag" ? "tag" : "category") : "item";
      items.push({ id, parent, order: id, label, url, ...(target !== undefined && { target: { kind, id: target } }) });
      walk(block.innerBlocks, id);
    }
  };
  walk(parseBlocks(content), 0);
  return { name, slug, items };
}

/**
 * Reads a WordPress export file. Throws `WordPressReadError` (`not-export-file`)
 * for anything else, such as a WordPress site's page saved from a browser.
 */
export function readWordPressExport(xml: string): WordPressSite {
  const document = parseXml(xml);
  const rss = childElements(document).find((element) => element.name === "rss");
  const channel = rss && child(rss, "channel");
  if (!channel || !childText(channel, "wp:wxr_version")) {
    throw new WordPressReadError("not-export-file", "This isn't a WordPress export file.");
  }

  const url = (childText(channel, "wp:base_blog_url") || childText(channel, "link")).trim().replace(/\/+$/, "");
  if (!/^https?:\/\/[^/\s]+/i.test(url)) {
    throw new WordPressReadError("not-export-file", "This export file doesn't say which site it's from.");
  }
  const categories: WordPressTerm[] = childElements(channel)
    .filter((element) => element.name === "wp:category")
    .map((element) => ({
      name: plainText(childText(element, "wp:cat_name")),
      slug: decodedSlug(childText(element, "wp:category_nicename")),
      ...(childText(element, "wp:category_parent") && {
        parent: decodedSlug(childText(element, "wp:category_parent")),
      }),
    }));
  const tags: WordPressTerm[] = childElements(channel)
    .filter((element) => element.name === "wp:tag")
    .map((element) => ({
      name: plainText(childText(element, "wp:tag_name")),
      slug: decodedSlug(childText(element, "wp:tag_slug")),
    }));
  // Menus are terms of their own, which their items name.
  const menuNames = new Map<string, string>();
  for (const element of childElements(channel).filter((candidate) => candidate.name === "wp:term")) {
    if (childText(element, "wp:term_taxonomy") === "nav_menu") {
      menuNames.set(decodedSlug(childText(element, "wp:term_slug")), plainText(childText(element, "wp:term_name")));
    }
  }

  const items: WordPressItem[] = [];
  const media: WordPressMedia[] = [];
  const menuItems = new Map<string, WordPressMenuItem[]>();
  const navigation: WordPressMenu[] = [];
  const reusableBlocks: Record<number, string> = {};
  const syncedPatterns: Record<number, { name: string; title: string }> = {};
  const other: Record<string, number> = {};
  const count = (kind: string, by = 1) => {
    if (by > 0) other[kind] = (other[kind] ?? 0) + by;
  };

  for (const item of childElements(channel).filter((element) => element.name === "item")) {
    const type = childText(item, "wp:post_type");
    const id = number(childText(item, "wp:post_id"));
    const status = childText(item, "wp:status");
    const title = plainText(childText(item, "title"));
    const content = childText(item, "content:encoded");
    const values = meta(item);
    if (type === "page" || type === "post") {
      count("comments", childElements(item).filter((element) => element.name === "wp:comment").length);
      const image = number(values._thumbnail_id ?? "");
      items.push({
        id,
        type,
        status,
        title,
        slug: decodedSlug(childText(item, "wp:post_name")),
        link: childText(item, "link").trim(),
        date: wordPressDate(childText(item, "wp:post_date")),
        parent: number(childText(item, "wp:post_parent")),
        order: number(childText(item, "wp:menu_order")),
        content,
        rendered: false,
        excerpt: childText(item, "excerpt:encoded"),
        categories: terms(item, "category"),
        tags: terms(item, "post_tag"),
        ...(image > 0 && { image }),
      });
    } else if (type === "attachment") {
      media.push({
        id,
        url: childText(item, "wp:attachment_url").trim() || childText(item, "guid").trim(),
        title,
        alt: values._wp_attachment_image_alt?.trim() ?? "",
        caption: plainText(childText(item, "excerpt:encoded")),
      });
    } else if (type === "nav_menu_item") {
      const menu = terms(item, "nav_menu")[0];
      if (!menu) continue;
      const kind = values._menu_item_type;
      const object = values._menu_item_object;
      const target = number(values._menu_item_object_id ?? "");
      const entry: WordPressMenuItem = {
        id,
        parent: number(values._menu_item_menu_item_parent ?? ""),
        order: number(childText(item, "wp:menu_order")),
        label: title,
        url: values._menu_item_url?.trim() ?? "",
        ...(kind === "post_type" && target > 0 && { target: { kind: "item" as const, id: target } }),
        ...(kind === "taxonomy" &&
          target > 0 && {
            target: { kind: object === "post_tag" ? ("tag" as const) : ("category" as const), id: target },
          }),
      };
      menuItems.set(menu, [...(menuItems.get(menu) ?? []), entry]);
    } else if (type === "wp_navigation") {
      if (status === "publish") {
        navigation.push(
          navigationMenu(title, decodedSlug(childText(item, "wp:post_name")) || `navigation-${id}`, content),
        );
      }
    } else if (type === "wp_block") {
      reusableBlocks[id] = content;
      if (values.wp_pattern_sync_status !== "unsynced" && status === "publish") {
        syncedPatterns[id] = { name: decodedSlug(childText(item, "wp:post_name")), title: title || `Pattern ${id}` };
      }
    } else if (!PARTS.has(type) && type) {
      count(type);
    }
  }

  // Taxonomy menu items name terms by id, which export files give as `wp:term_id`.
  const termSlugs = new Map<number, string>();
  for (const element of childElements(channel)) {
    if (element.name === "wp:category" || element.name === "wp:tag") {
      const slug = childText(element, element.name === "wp:category" ? "wp:category_nicename" : "wp:tag_slug");
      termSlugs.set(number(childText(element, "wp:term_id")), decodedSlug(slug));
    }
  }
  const menus: WordPressMenu[] = [
    ...[...menuItems].map(([slug, entries]) => ({
      name: menuNames.get(slug) ?? slug,
      slug,
      items: entries.map((entry) =>
        entry.target && entry.target.kind !== "item"
          ? { ...entry, url: entry.url || termLink(url, entry.target.kind, termSlugs.get(entry.target.id)) }
          : entry,
      ),
    })),
    ...navigation,
  ];

  const language = textOf(child(channel, "language") ?? []).trim();
  return {
    title: plainText(childText(channel, "title")),
    description: plainText(childText(channel, "description")),
    url,
    ...(language && { language }),
    items,
    categories,
    tags,
    menus,
    media,
    reusableBlocks,
    syncedPatterns,
    other,
    source: "export-file",
  };
}

/** A category's or tag's archive address, as WordPress makes it unless its settings say otherwise. */
function termLink(site: string, kind: "category" | "tag", slug: string | undefined): string {
  return slug ? `${site}/${kind}/${encodeURIComponent(slug)}/` : "";
}

/** Whether content was written with the block editor; classic content has paragraphs separated by blank lines instead. */
export function isBlockContent(item: Pick<WordPressItem, "content" | "rendered">): boolean {
  return !item.rendered && hasBlocks(item.content);
}
