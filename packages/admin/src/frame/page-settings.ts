import { neverIndexed, VISIBILITY_PROP } from "@goodfellow-cms/core";
import type { Config, Data } from "@puckeditor/core";

/**
 * Page settings as the editor shows them where a page hasn't chosen: "Search
 * engines" shows that the page is in search results, as it is unless its
 * settings say otherwise, and "The site's search" that the page is in it; on
 * "Page not found", which never is in either, both show that it isn't, with no
 * choice; the other search engine settings, and the picture size when shared,
 * show what they are where a page leaves them out.
 * `keep()` takes them out again, so files hold only what editors chose.
 */
export interface ShownSettings {
  show(data: Data): Data;
  keep(data: Data): Data;
}

type Root = Data["root"] & { props?: Record<string, unknown>; readOnly?: Record<string, boolean> };

/** What each setting is where a page leaves it out, which the editor shows as chosen. */
const SHOWN_DEFAULTS: Readonly<Record<string, unknown>> = {
  noIndex: false,
  noSearch: false,
  visibility: "everyone",
  noFollow: false,
  noSnippet: false,
  card: "auto",
};

/**
 * Puck's config without "Who can see this page" (`visibility`), for a site
 * with no server to keep pages to its members. A page that already says
 * keeps what it says, since Puck keeps settings it has no field for.
 */
export function withoutVisibility(config: Config): Config {
  const fields = config.root?.fields;
  if (!fields || !(VISIBILITY_PROP in fields)) return config;
  const { [VISIBILITY_PROP]: _visibility, ...rest } = fields;
  return { ...config, root: { ...config.root, fields: rest } };
}

/** The settings "Page not found" has whatever its file says, which the editor shows with no choice. */
const FIXED: Readonly<Record<string, unknown>> = { noIndex: true, noSearch: true };

/** Every setting in `FIXED`, as read-only. */
const FIXED_READ_ONLY = Object.fromEntries(Object.keys(FIXED).map((name) => [name, true]));

/** For pages and templates, whose settings include `noIndex`; `path` is the page's, for pages. */
export function shownSettings(original: Data, path: string | undefined): ShownSettings {
  const fixed = path !== undefined && neverIndexed(path);
  const originalRoot = original.root as Root;
  const originalProps = originalRoot.props ?? {};

  return {
    show(data) {
      const root = data.root as Root;
      const missing = Object.entries(SHOWN_DEFAULTS).filter(([name]) => root.props?.[name] === undefined);
      if (missing.length === 0 && !fixed) return data;
      const props = { ...root.props, ...Object.fromEntries(missing) };
      if (fixed) {
        return {
          ...data,
          root: { ...root, props: { ...props, ...FIXED }, readOnly: { ...root.readOnly, ...FIXED_READ_ONLY } },
        };
      }
      return { ...data, root: { ...root, props } };
    },
    keep(data) {
      const root = data.root as Root;
      const props = { ...root.props };
      for (const [name, value] of Object.entries(SHOWN_DEFAULTS)) {
        // "Page not found" keeps what its file says, since it can't be changed; elsewhere, leaving the
        // default unchosen means the same as choosing it.
        const kept =
          (fixed && name in FIXED) || (originalProps[name] === undefined && props[name] === value)
            ? originalProps[name]
            : props[name];
        if (kept === undefined) delete props[name];
        else props[name] = kept;
      }
      const { readOnly: _shown, ...rest } = root;
      const readOnly = fixed ? originalRoot.readOnly : root.readOnly;
      return { ...data, root: { ...rest, props, ...(readOnly && { readOnly }) } };
    },
  };
}
