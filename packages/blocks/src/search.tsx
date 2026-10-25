import { SEARCH_ATTRIBUTE } from "@goodfellow-cms/core";
import { classNameField, useParts, withParts } from "@goodfellow-cms/react";
import type { ComponentConfig } from "@puckeditor/core";
import { SEARCH_PARTS } from "./parts.js";
import { SearchBox } from "./search-box.js";

export interface SearchProps {
  label: string;
  placeholder: string;
  noResults: string;
  unavailable: string;
  className: string;
}

/**
 * A search box for the whole site, which shows results as visitors type. Sites
 * with one get a search index when they're built (with Pagefind), which searches
 * in the visitor's browser, so no search service is needed.
 */
export const Search: ComponentConfig<SearchProps> = withParts(
  {
    label: "Search",
    fields: {
      placeholder: { type: "text", label: "Text in the empty box" },
      label: { type: "text", label: "Name of the box, for screen readers" },
      noResults: { type: "text", label: "When nothing matches ({query} is what was searched for)" },
      unavailable: { type: "text", label: "When search isn't available, such as before the site is built" },
      className: classNameField,
    },
    defaultProps: {
      placeholder: "Search",
      label: "Search this site",
      noResults: "Nothing matches “{query}”.",
      unavailable: "Search works on the published site.",
      className: "",
    },
    render: ({ className, label, placeholder, noResults, unavailable }) => {
      const part = useParts();
      return (
        // The attribute tells builds to index the site; the box itself runs in the browser.
        // Only the text goes to the box: Puck's own props include functions, which Next.js can't pass to the browser.
        <div className={part("gf-search", "w-full max-w-sm", className)} {...{ [SEARCH_ATTRIBUTE]: "" }}>
          <SearchBox label={label} placeholder={placeholder} noResults={noResults} unavailable={unavailable} />
        </div>
      );
    },
  },
  SEARCH_PARTS,
);
