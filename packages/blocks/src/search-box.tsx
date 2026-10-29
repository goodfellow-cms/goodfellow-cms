import { SEARCH_BOX_ATTRIBUTE, withBase } from "@goodfellow-cms/core";
import { useParts, useSite } from "@goodfellow-cms/react";

export interface SearchBoxProps {
  label: string;
  placeholder: string;
  noResults: string;
  unavailable: string;
}

/**
 * A search box with results as you type, from the site's Pagefind index,
 * which `searchScript()` from `@goodfellow-cms/core` makes work. What it
 * needs is in the HTML: its words, the site's address (`data-gf-base`,
 * which builds give the base path) and the classes of the results it adds.
 */
export function SearchBox({ label, placeholder, noResults, unavailable }: SearchBoxProps) {
  const { base } = useSite();
  const part = useParts();
  return (
    <search
      className={part("gf-search-box", "relative block")}
      data-gf-base={withBase("/", base)}
      data-gf-no-results={noResults}
      data-gf-unavailable={unavailable}
      {...{ [SEARCH_BOX_ATTRIBUTE]: "" }}
    >
      <input
        type="search"
        aria-label={label}
        autoComplete="off"
        placeholder={placeholder}
        className={part(
          "gf-search-input",
          "w-full rounded-md border border-border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-2 focus:outline-primary",
        )}
      />
      <div
        hidden
        data-gf-search-results=""
        className={part(
          "gf-search-results",
          "absolute inset-x-0 top-full z-50 mt-2 max-h-[70vh] overflow-y-auto rounded-lg border border-border bg-background p-2 shadow-lg",
        )}
      >
        <p
          hidden
          data-gf-search-message=""
          className={part("gf-search-message", "p-2 text-sm text-muted-foreground")}
        />
        <ul
          className="flex flex-col"
          data-gf-search-list=""
          data-gf-link-class={part("gf-search-result", "block rounded-md p-2 hover:bg-muted focus-visible:bg-muted")}
          data-gf-title-class={part("gf-search-result-title", "block font-medium")}
          data-gf-excerpt-class={part("gf-search-result-excerpt", "block text-sm text-muted-foreground")}
        />
      </div>
    </search>
  );
}
