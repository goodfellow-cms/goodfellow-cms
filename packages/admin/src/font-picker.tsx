import type { FontCategory } from "@goodfellow-cms/core";
import { type KeyboardEvent, useEffect, useId, useMemo, useRef, useState } from "react";
import { type StringKey, useStrings } from "./strings.js";

export type { FontCategory };
export type Font = readonly [family: string, category: FontCategory];

/** How many fonts the list shows at once. Searching finds the rest. */
const SHOWN = 60;

const categoryLabels: Record<FontCategory, StringKey> = {
  "sans-serif": "font.category.sans-serif",
  serif: "font.category.serif",
  display: "font.category.display",
  handwriting: "font.category.handwriting",
  monospace: "font.category.monospace",
};

/** Fonts whose names contain the search, those starting with it first, in the list's order otherwise. */
export function searchFonts(fonts: readonly Font[], query: string, limit = SHOWN): Font[] {
  const search = query.trim().toLowerCase();
  if (!search) return fonts.slice(0, limit);
  const starts: Font[] = [];
  const contains: Font[] = [];
  for (const font of fonts) {
    const name = font[0].toLowerCase();
    if (name.startsWith(search)) starts.push(font);
    else if (name.includes(search)) contains.push(font);
    if (starts.length >= limit) break;
  }
  return [...starts, ...contains].slice(0, limit);
}

/** The Google Fonts list, loaded when a font picker first opens, since it's large. */
let fontList: Promise<readonly Font[]> | undefined;
function loadFonts(): Promise<readonly Font[]> {
  fontList ??= import("./google-fonts.js").then((module) => module.GOOGLE_FONTS);
  return fontList;
}

/** Families whose names are shown in their own typeface. Each loads only the letters of its name. */
const previewed = new Set<string>();
function previewFont(family: string): void {
  if (previewed.has(family)) return;
  previewed.add(family);
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family)}&text=${encodeURIComponent(family)}&display=swap`;
  document.head.append(link);
}

/** One font in the list, shown in its own typeface once it's scrolled into view. */
function FontOption({
  font,
  id,
  active,
  selected,
  onPick,
  onHover,
}: {
  font: Font;
  id: string;
  active: boolean;
  selected: boolean;
  onPick: () => void;
  onHover: () => void;
}) {
  const t = useStrings();
  const ref = useRef<HTMLDivElement>(null);
  const [family, category] = font;

  useEffect(() => {
    const element = ref.current;
    if (!element || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        previewFont(family);
        observer.disconnect();
      }
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [family]);

  useEffect(() => {
    if (active) ref.current?.scrollIntoView({ block: "nearest" });
  }, [active]);

  return (
    // The list is driven from the search box, as a combobox's is, so options don't take focus themselves.
    // biome-ignore lint/a11y/useKeyWithClickEvents: the search box handles the keyboard
    <div
      ref={ref}
      id={id}
      role="option"
      tabIndex={-1}
      aria-selected={selected}
      className={`gfa-font-option${active ? " gfa-font-option-active" : ""}`}
      // Keeps focus in the search box, so choosing doesn't close the list before the click lands.
      onMouseDown={(event) => event.preventDefault()}
      onMouseMove={onHover}
      onClick={onPick}
    >
      <span style={{ fontFamily: `"${family}", system-ui, sans-serif` }}>{family}</span>
      <span className="gfa-font-category">{t(categoryLabels[category])}</span>
    </div>
  );
}

/**
 * Chooses a Google Fonts family, by searching a list of them, or the site's
 * default font (an empty value). A font the list doesn't have, such as one
 * set before, is still shown and kept.
 */
export function FontPicker({
  label,
  value,
  error,
  onChange,
}: {
  label: string;
  value: string;
  error?: string;
  /** The family, empty for the site's default, and its kind, which pages fall back to while it loads. */
  onChange: (value: string, category: FontCategory | undefined) => void;
}) {
  const t = useStrings();
  const id = useId();
  const [fonts, setFonts] = useState<readonly Font[] | undefined>();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);

  useEffect(() => {
    if (open && !fonts) void loadFonts().then(setFonts);
  }, [open, fonts]);
  useEffect(() => {
    if (value) previewFont(value);
  }, [value]);

  // "Site default" first, then the matching fonts.
  const options = useMemo<Array<Font | null>>(() => {
    const matches = fonts ? searchFonts(fonts, query) : [];
    const known = fonts?.some(([family]) => family === value) ?? true;
    const current: Font[] = value && !known && !query ? [[value, "sans-serif"]] : [];
    return [...(query ? [] : [null]), ...current, ...matches];
  }, [fonts, query, value]);

  const close = () => {
    setOpen(false);
    setQuery("");
  };
  const pick = (option: Font | null) => {
    onChange(option ? option[0] : "", option?.[1]);
    close();
  };
  const openList = () => {
    setOpen(true);
    setActive(0);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!open) return openList();
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActive((index) => Math.min(Math.max(index + step, 0), options.length - 1));
    } else if (event.key === "Enter" && open) {
      event.preventDefault();
      const option = options[active];
      if (option !== undefined) pick(option);
    } else if (event.key === "Escape" && open) {
      event.preventDefault();
      close();
    }
  };

  const listId = `${id}-list`;
  const optionId = (index: number) => `${id}-option-${index}`;
  const describedBy = [`${id}-hint`, error && `${id}-error`].filter(Boolean).join(" ");

  return (
    <div className="gfa-field gfa-font-picker">
      <label htmlFor={id} className="gfa-label">
        {label}
      </label>
      <input
        id={id}
        className="gfa-input"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && options[active] !== undefined ? optionId(active) : undefined}
        aria-describedby={describedBy}
        aria-invalid={error ? true : undefined}
        autoComplete="off"
        spellCheck={false}
        placeholder={open ? t("font.search") : undefined}
        value={open ? query : value || t("font.default")}
        style={!open && value ? { fontFamily: `"${value}", system-ui, sans-serif` } : undefined}
        onFocus={openList}
        onClick={() => !open && openList()}
        onBlur={close}
        onChange={(event) => {
          setQuery(event.target.value);
          setActive(0);
          setOpen(true);
        }}
        onKeyDown={onKeyDown}
      />
      <p id={`${id}-hint`} className="gfa-visually-hidden">
        {t("font.searchHint")}
      </p>
      {open && (
        <div id={listId} role="listbox" aria-label={label} className="gfa-font-list">
          {!fonts && <div className="gfa-font-empty">{t("font.loading")}</div>}
          {fonts && options.length === 0 && <div className="gfa-font-empty">{t("font.noMatch", { query })}</div>}
          {options.map((option, index) =>
            option ? (
              <FontOption
                key={option[0]}
                font={option}
                id={optionId(index)}
                active={index === active}
                selected={option[0] === value}
                onPick={() => pick(option)}
                onHover={() => setActive(index)}
              />
            ) : (
              // biome-ignore lint/a11y/useKeyWithClickEvents: the search box handles the keyboard
              <div
                key=""
                id={optionId(index)}
                role="option"
                tabIndex={-1}
                aria-selected={!value}
                className={`gfa-font-option${index === active ? " gfa-font-option-active" : ""}`}
                onMouseDown={(event) => event.preventDefault()}
                onMouseMove={() => setActive(index)}
                onClick={() => pick(null)}
              >
                <span>{t("font.default")}</span>
                <span className="gfa-font-category">{t("font.defaultHint")}</span>
              </div>
            ),
          )}
        </div>
      )}
      {error && (
        <p id={`${id}-error`} className="gfa-error-text">
          {error}
        </p>
      )}
    </div>
  );
}
