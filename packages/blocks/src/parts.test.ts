import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { isPartName } from "@goodfellow-cms/core";
import { blockParts } from "@goodfellow-cms/react";
import { describe, expect, it } from "vitest";
import { blocks } from "./index.js";

/**
 * Every part name built-in blocks have had. Themes give these names classes,
 * so a name can be added here, never removed or renamed.
 */
const PUBLISHED = [
  "gf-add-to-calendar",
  "gf-add-to-calendar-label",
  "gf-add-to-calendar-link",
  "gf-add-to-calendar-links",
  "gf-audio",
  "gf-audio-caption",
  "gf-audio-player",
  "gf-breadcrumbs",
  "gf-breadcrumbs-current",
  "gf-breadcrumbs-item",
  "gf-breadcrumbs-link",
  "gf-breadcrumbs-list",
  "gf-breadcrumbs-separator",
  "gf-button",
  "gf-calendar",
  "gf-calendar-day",
  "gf-calendar-day-heading",
  "gf-calendar-days",
  "gf-calendar-empty",
  "gf-calendar-event",
  "gf-calendar-event-body",
  "gf-calendar-event-place",
  "gf-calendar-event-summary",
  "gf-calendar-event-time",
  "gf-calendar-event-title",
  "gf-calendar-events",
  "gf-calendar-month",
  "gf-calendar-month-blank",
  "gf-calendar-month-date",
  "gf-calendar-month-day",
  "gf-calendar-month-days",
  "gf-calendar-month-event",
  "gf-calendar-month-events",
  "gf-calendar-month-header",
  "gf-calendar-month-link",
  "gf-calendar-month-title",
  "gf-calendar-subscribe",
  "gf-calendar-subscribe-label",
  "gf-calendar-subscribe-link",
  "gf-calendar-subscribe-links",
  "gf-calendar-weekdays",
  "gf-card",
  "gf-card-body",
  "gf-card-date",
  "gf-card-image",
  "gf-card-summary",
  "gf-card-title",
  "gf-choice-link",
  "gf-choices",
  "gf-code",
  "gf-code-copy",
  "gf-code-title",
  "gf-collection-list",
  "gf-collection-list-empty",
  "gf-collection-list-header",
  "gf-collection-list-heading",
  "gf-collection-list-items",
  "gf-collection-list-more",
  "gf-collection-loop",
  "gf-collection-loop-design",
  "gf-collection-loop-empty",
  "gf-collection-loop-item",
  "gf-collection-loop-items",
  "gf-collection-nav",
  "gf-collection-nav-group",
  "gf-collection-nav-group-label",
  "gf-collection-nav-heading",
  "gf-collection-nav-link",
  "gf-collection-nav-links",
  "gf-columns",
  "gf-contact",
  "gf-contact-address",
  "gf-contact-email",
  "gf-contact-phone",
  "gf-dark-mode-switch",
  "gf-dark-mode-switch-thumb",
  "gf-dark-mode-switch-track",
  "gf-details",
  "gf-details-content",
  "gf-details-summary",
  "gf-document",
  "gf-document-caption",
  "gf-document-frame",
  "gf-document-link",
  "gf-donate",
  "gf-donate-button",
  "gf-donate-heading",
  "gf-donate-note",
  "gf-donate-text",
  "gf-entry-field",
  "gf-entry-field-link",
  "gf-entry-pager",
  "gf-entry-pager-label",
  "gf-entry-pager-link",
  "gf-entry-pager-title",
  "gf-file",
  "gf-file-button",
  "gf-file-link",
  "gf-form",
  "gf-form-check",
  "gf-form-choice",
  "gf-form-embed",
  "gf-form-hint",
  "gf-form-input",
  "gf-form-label",
  "gf-form-question",
  "gf-form-questions",
  "gf-form-required",
  "gf-form-submit",
  "gf-gallery",
  "gf-gallery-caption",
  "gf-gallery-item",
  "gf-gallery-item-caption",
  "gf-gallery-items",
  "gf-gallery-picture",
  "gf-heading",
  "gf-image",
  "gf-image-caption",
  "gf-image-picture",
  "gf-language-current",
  "gf-language-link",
  "gf-language-list",
  "gf-language-switch",
  "gf-list-item",
  "gf-list-item-body",
  "gf-list-item-date",
  "gf-list-item-image",
  "gf-list-item-summary",
  "gf-list-item-title",
  "gf-media-text",
  "gf-media-text-content",
  "gf-media-text-media",
  "gf-menu",
  "gf-menu-button",
  "gf-menu-item",
  "gf-menu-link",
  "gf-menu-list",
  "gf-menu-panel",
  "gf-menu-submenu",
  "gf-menu-toggle",
  "gf-on-this-page",
  "gf-on-this-page-heading",
  "gf-on-this-page-link",
  "gf-on-this-page-links",
  "gf-page-link",
  "gf-page-links",
  "gf-page-list",
  "gf-page-list-children",
  "gf-page-list-item",
  "gf-page-list-link",
  "gf-page-numbers",
  "gf-preformatted",
  "gf-pullquote",
  "gf-pullquote-citation",
  "gf-pullquote-quote",
  "gf-row",
  "gf-search",
  "gf-search-box",
  "gf-search-input",
  "gf-search-message",
  "gf-search-result",
  "gf-search-result-excerpt",
  "gf-search-result-title",
  "gf-search-results",
  "gf-section",
  "gf-section-content",
  "gf-section-overlay",
  "gf-separator",
  "gf-share",
  "gf-share-label",
  "gf-share-link",
  "gf-share-list",
  "gf-site-brand",
  "gf-site-brand-logo",
  "gf-site-brand-name",
  "gf-site-brand-tagline",
  "gf-site-brand-text",
  "gf-space",
  "gf-table",
  "gf-table-caption",
  "gf-table-cell",
  "gf-table-grid",
  "gf-table-header-cell",
  "gf-table-row",
  "gf-text",
  "gf-verse",
  "gf-video",
  "gf-video-caption",
  "gf-video-player",
];

/** Classes in blocks that aren't parts' names: the stylesheet's own. */
const NOT_PARTS = new Set(["gf-prose"]);

/** Every quoted gf- name in the blocks' code, other than the parts list itself. */
function namesInCode(): Set<string> {
  const dir = join(import.meta.dirname);
  const files = readdirSync(dir).filter((file) => /\.tsx?$/.test(file) && !/\.test\.|^parts\.ts$/.test(file));
  const names = new Set<string>();
  for (const file of files) {
    for (const [, name] of readFileSync(join(dir, file), "utf8").matchAll(/"(gf-[a-z0-9-]+)"/g)) {
      if (name && !NOT_PARTS.has(name)) names.add(name);
    }
  }
  return names;
}

const declared = new Map<string, string>();
for (const block of Object.values(blocks)) {
  for (const [name, label] of Object.entries(blockParts(block) ?? {})) declared.set(name, label);
}

describe("blocks' named parts", () => {
  it("are declared by every block, each named gf- and given a label", () => {
    for (const [name, block] of Object.entries(blocks)) {
      expect(blockParts(block), name).toBeDefined();
    }
    for (const [name, label] of declared) {
      expect(isPartName(name), name).toBe(true);
      expect(label.trim(), name).not.toBe("");
    }
  });

  it("declares every part the blocks render, and renders every part they declare", () => {
    const rendered = namesInCode();
    expect([...rendered].filter((name) => !declared.has(name))).toEqual([]);
    expect([...declared.keys()].filter((name) => !rendered.has(name))).toEqual([]);
  });

  it("never renames or removes a part a theme could use", () => {
    expect(PUBLISHED.filter((name) => !declared.has(name))).toEqual([]);
  });
});
