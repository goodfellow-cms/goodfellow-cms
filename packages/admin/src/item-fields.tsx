/**
 * The item editor's controls for links to items and for several images: a
 * searchable list of another collection's items, and a list of images to add
 * to, order and take out.
 */
import { type Collection, entryTitle } from "@goodfellow-cms/core";
import { useId, useState } from "react";
import { MediaChooser, MediaThumb } from "./media-library.js";
import { useStrings } from "./strings.js";
import { Button } from "./ui.js";

/** How many matches the item picker lists at once; searching narrows the rest. */
const SHOWN_MATCHES = 50;

/** The items a link can name: the collection's own, never translations, which links reach through the item they translate. */
export function linkableItems(collection: Collection | undefined): Array<{ slug: string; title: string }> {
  return (collection?.entries ?? [])
    .filter((entry) => entry.content.translationOf === undefined)
    .map((entry) => ({ slug: entry.slug, title: entryTitle(entry) }))
    .sort((a, b) => a.title.localeCompare(b.title));
}

/** Chooses one item, or several, of a collection, by searching their titles. */
export function ItemPicker({
  id,
  collection,
  multiple,
  value,
  onChange,
}: {
  id: string;
  collection: Collection | undefined;
  multiple: boolean;
  value: unknown;
  onChange: (value: string | string[] | undefined) => void;
}) {
  const t = useStrings();
  const listId = useId();
  const [search, setSearch] = useState("");
  const items = linkableItems(collection);
  const chosen = typeof value === "string" ? (value ? [value] : []) : Array.isArray(value) ? value.map(String) : [];
  const name = collection?.settings.name ?? "";
  const titleOf = (slug: string) => items.find((item) => item.slug === slug)?.title ?? slug;
  const words = search.trim().toLowerCase();
  const matches = items.filter(
    (item) => !chosen.includes(item.slug) && (!words || item.title.toLowerCase().includes(words)),
  );
  const set = (next: string[]) => onChange(multiple ? (next.length > 0 ? next : undefined) : next[0]);

  if (!collection) return <p className="gfa-puck-hint">{t("editEntry.items.missing")}</p>;
  if (items.length === 0) return <p className="gfa-puck-hint">{t("editEntry.items.empty", { name })}</p>;
  return (
    <div className="gfa-item-picker">
      {chosen.length > 0 && (
        <ul className="gfa-item-picker-chosen">
          {chosen.map((slug) => (
            <li key={slug} className="gfa-chosen-row">
              <span className="gfa-chosen-row-name">{titleOf(slug)}</span>
              <Button
                variant="ghost"
                aria-label={t("editEntry.items.remove", { title: titleOf(slug) })}
                onClick={() => set(chosen.filter((other) => other !== slug))}
              >
                ×
              </Button>
            </li>
          ))}
        </ul>
      )}
      {(multiple || chosen.length === 0) && (
        <>
          <input
            id={id}
            type="search"
            className="gfa-puck-input"
            placeholder={t("editEntry.items.search", { name })}
            aria-controls={listId}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <ul id={listId} className="gfa-item-picker-matches">
            {matches.slice(0, SHOWN_MATCHES).map((item) => (
              <li key={item.slug}>
                <button
                  type="button"
                  onClick={() => {
                    set([...chosen, item.slug]);
                    setSearch("");
                  }}
                >
                  {item.title}
                </button>
              </li>
            ))}
            {matches.length === 0 && <li className="gfa-puck-hint">{t("editEntry.items.none", { name })}</li>}
          </ul>
        </>
      )}
    </div>
  );
}

/** Several images, in order: each can move up or down or be taken out, and the media chooser adds more. */
export function ImagesField({ value, onChange }: { value: unknown; onChange: (value: string[] | undefined) => void }) {
  const t = useStrings();
  const images = Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && !!item) : [];
  const set = (next: string[]) => onChange(next.length > 0 ? next : undefined);
  const move = (index: number, by: number) => {
    const next = [...images];
    const [moved] = next.splice(index, 1);
    next.splice(index + by, 0, moved as string);
    set(next);
  };
  return (
    <div className="gfa-images-field">
      {images.length > 0 && (
        <ul>
          {images.map((src, index) => (
            <li key={src} className="gfa-chosen-row">
              <MediaThumb url={src} className="gfa-images-field-thumb" />
              <span className="gfa-chosen-row-name">{src.slice(src.lastIndexOf("/") + 1)}</span>
              <Button
                variant="ghost"
                disabled={index === 0}
                aria-label={t("editEntry.images.up")}
                onClick={() => move(index, -1)}
              >
                ↑
              </Button>
              <Button
                variant="ghost"
                disabled={index === images.length - 1}
                aria-label={t("editEntry.images.down")}
                onClick={() => move(index, 1)}
              >
                ↓
              </Button>
              <Button
                variant="ghost"
                aria-label={t("editEntry.images.remove")}
                onClick={() => set(images.filter((_, other) => other !== index))}
              >
                ×
              </Button>
            </li>
          ))}
        </ul>
      )}
      <MediaChooser value="" kind="image" onChange={(src) => src && !images.includes(src) && set([...images, src])} />
    </div>
  );
}
