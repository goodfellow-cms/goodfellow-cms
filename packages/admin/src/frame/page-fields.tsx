/**
 * The page's own settings in the editor's sidebar, grouped: what most pages
 * set first, then the rarer search engine settings in a group that starts
 * closed, then how the page looks when it's shared, with its preview. A
 * block's settings, and settings the page's fields don't name, are left as
 * Puck lays them out.
 */
import { FieldGroup } from "@puckeditor/core";
import type { ReactNode } from "react";
import { SharePreview } from "../share-preview.js";
import { useStrings } from "../strings.js";

/** Search engine settings few pages change. "Search engines" itself (`noIndex`) stays with the title. */
const SEARCH_FIELDS = ["noFollow", "noSnippet"];
/** How a link to the page looks when it's shared. */
const SHARING_FIELDS = ["image", "card"];
/** The page's Style setting, last, as on blocks. */
const STYLE_FIELD = "className";

/** Puck's `fields` override for the page's settings and a template's. */
export function PageFields({
  children,
  fields,
  itemSelector,
  path,
}: {
  children: ReactNode;
  fields?: Partial<Record<string, ReactNode>>;
  itemSelector?: unknown;
  /** The page's address, for its share preview; a template has none. */
  path?: string;
}) {
  const t = useStrings();
  // A block's settings, or a Puck too old to hand over the fields, are left alone.
  if (itemSelector || !fields) return <>{children}</>;
  const grouped = new Set([...SEARCH_FIELDS, ...SHARING_FIELDS, STYLE_FIELD]);
  const pick = (names: string[]) => names.map((name) => fields[name]).filter((field) => field != null);
  const search = pick(SEARCH_FIELDS);
  const sharing = pick(SHARING_FIELDS);
  return (
    <>
      {Object.entries(fields)
        .filter(([name]) => !grouped.has(name))
        .map(([, field]) => field)}
      {search.length > 0 && (
        <FieldGroup id="gf-page-search" label={t("pageSettings.search")} defaultExpanded={false}>
          {search}
        </FieldGroup>
      )}
      {(sharing.length > 0 || path) && (
        <FieldGroup id="gf-page-sharing" label={t("pageSettings.sharing")} defaultExpanded>
          {sharing}
          {path && <SharePreview path={path} />}
        </FieldGroup>
      )}
      {fields[STYLE_FIELD]}
    </>
  );
}
