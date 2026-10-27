/**
 * A search box at the top of Puck's block list, which Puck doesn't have: while
 * something's typed, the list is the blocks it finds, by their labels, names,
 * groups and keywords (`withKeywords()`), still dragged onto the page as from
 * Puck's own list.
 */
import type { GoodfellowConfig } from "@goodfellow-cms/core";
import { blockKeywords } from "@goodfellow-cms/react";
import { type Config, Drawer } from "@puckeditor/core";
import { type ReactNode, useId, useState } from "react";
import { useStrings } from "../strings.js";

/** What a block is found by. */
export interface SearchableBlock {
  name: string;
  label: string;
  group?: string;
  keywords: readonly string[];
}

/** The blocks of a Puck config, with their groups and the site's keywords for them, in the list's order. */
export function searchableBlocks(config: Config, siteConfig?: Pick<GoodfellowConfig, "blocks">): SearchableBlock[] {
  const groups = new Map<string, string>();
  const order: string[] = [];
  for (const [key, category] of Object.entries(config.categories ?? {})) {
    for (const name of category?.components ?? []) {
      const block = String(name);
      if (!config.components[block] || groups.has(block)) continue;
      groups.set(block, category?.title ?? key);
      order.push(block);
    }
  }
  for (const name of Object.keys(config.components)) if (!groups.has(name)) order.push(name);
  return order.map((name) => {
    const block = siteConfig?.blocks[name];
    return {
      name,
      label: config.components[name]?.label ?? name,
      ...(groups.has(name) && { group: groups.get(name) }),
      keywords: (block && blockKeywords(block)) ?? [],
    };
  });
}

/** A block's name as words: `MediaText` is "media text". */
function nameWords(name: string): string {
  return name.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[-_]+/g, " ");
}

/** Whether every word typed starts a word of `text`. */
function startsWords(text: string, words: readonly string[]): boolean {
  const lower = ` ${text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ")}`;
  return words.every((word) => lower.includes(` ${word}`));
}

/** The blocks `query` finds, best first: by label, then by name or keyword, then by group. */
export function searchBlocks(query: string, blocks: readonly SearchableBlock[]): SearchableBlock[] {
  const words = query
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
  if (words.length === 0) return [...blocks];
  const rank = (block: SearchableBlock): number | undefined => {
    if (block.label.toLowerCase().startsWith(query.trim().toLowerCase())) return 0;
    if (startsWords(block.label, words)) return 1;
    if (startsWords(nameWords(block.name), words) || block.keywords.some((keyword) => startsWords(keyword, words))) {
      return 2;
    }
    if (block.group && startsWords(`${block.group} ${block.label}`, words)) return 3;
    return undefined;
  };
  return blocks
    .map((block, index) => ({ block, index, rank: rank(block) }))
    .filter((found): found is { block: SearchableBlock; index: number; rank: number } => found.rank !== undefined)
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map(({ block }) => block);
}

/** Puck's `drawer` override: the search box, then Puck's own list or what's found. */
export function BlockSearch({ blocks, children }: { blocks: readonly SearchableBlock[]; children: ReactNode }) {
  const t = useStrings();
  const [query, setQuery] = useState("");
  const id = useId();
  const found = query.trim() ? searchBlocks(query, blocks) : undefined;
  return (
    <div className="gfa-block-search">
      <div className="gfa-block-search-box">
        <input
          id={id}
          type="search"
          className="gfa-block-search-input"
          aria-label={t("editor.blockSearch")}
          placeholder={t("editor.blockSearch")}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") setQuery("");
          }}
        />
      </div>
      {found === undefined ? (
        children
      ) : found.length === 0 ? (
        <p className="gfa-block-search-none" role="status">
          {t("editor.blockSearchNone")}
        </p>
      ) : (
        <section className="gfa-block-search-results" aria-label={t("editor.blockSearchFound")}>
          <Drawer>
            {found.map((block, index) => (
              <Drawer.Item key={block.name} name={block.name} label={block.label} index={index} />
            ))}
          </Drawer>
        </section>
      )}
    </div>
  );
}
