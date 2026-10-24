import { neverIndexed } from "@goodfellow-cms/core";
import type { Data } from "@puckeditor/core";

/**
 * Page settings as the editor shows them where a page hasn't chosen: "Search
 * engines" shows that the page is in search results, as it is unless its
 * settings say otherwise, and on "Page not found", which never is, shows that
 * it isn't, with no choice. `keep()` takes them out again, so files hold only
 * what editors chose.
 */
export interface ShownSettings {
  show(data: Data): Data;
  keep(data: Data): Data;
}

type Root = Data["root"] & { props?: Record<string, unknown>; readOnly?: Record<string, boolean> };

/** For pages and templates, whose settings include `noIndex`; `path` is the page's, for pages. */
export function shownSettings(original: Data, path: string | undefined): ShownSettings {
  const fixed = path !== undefined && neverIndexed(path);
  const originalRoot = original.root as Root;
  const originalValue = originalRoot.props?.noIndex;

  return {
    show(data) {
      const root = data.root as Root;
      if (fixed) {
        return {
          ...data,
          root: { ...root, props: { ...root.props, noIndex: true }, readOnly: { ...root.readOnly, noIndex: true } },
        };
      }
      if (root.props?.noIndex !== undefined) return data;
      return { ...data, root: { ...root, props: { ...root.props, noIndex: false } } };
    },
    keep(data) {
      const root = data.root as Root;
      const { noIndex, ...props } = root.props ?? {};
      // "Page not found" keeps what its file says, since it can't be changed; elsewhere, leaving the
      // default unchosen means the same as choosing it.
      const kept = fixed || (originalValue === undefined && noIndex === false) ? originalValue : noIndex;
      const { readOnly: _shown, ...rest } = root;
      const readOnly = fixed ? originalRoot.readOnly : root.readOnly;
      return {
        ...data,
        root: {
          ...rest,
          props: kept === undefined ? props : { ...props, noIndex: kept },
          ...(readOnly && { readOnly }),
        },
      };
    },
  };
}
