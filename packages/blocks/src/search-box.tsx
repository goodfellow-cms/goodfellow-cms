"use client";

import { SEARCH_INDEX_DIR, withBase } from "@goodfellow-cms/core";
import { SiteLink, useSite } from "@goodfellow-cms/react";
import { useEffect, useId, useRef, useState } from "react";

interface Result {
  url: string;
  title: string;
  excerpt: string;
}

interface Pagefind {
  options(options: { baseUrl: string }): Promise<void>;
  destroy(): Promise<void>;
  debouncedSearch(query: string): Promise<{ results: Array<{ data(): Promise<PagefindData> }> } | null>;
}

interface PagefindData {
  url: string;
  excerpt: string;
  meta: { title?: string };
}

/** Pagefind's excerpts are escaped text with the matches in <mark>; any other `<` or `>` is shown as text. */
function excerptHtml(excerpt: string): string {
  return excerpt
    .split(/(<\/?mark>)/)
    .map((part) => (/^<\/?mark>$/.test(part) ? part : part.replace(/</g, "&lt;").replace(/>/g, "&gt;")))
    .join("");
}

let loaded: Promise<Pagefind> | undefined;
/** The page language Pagefind started in, which chose the index it searches. */
let loadedLanguage: string | undefined;

/**
 * Loads Pagefind from the site's own index, which the build wrote. Pagefind
 * searches the pages in the language `<html lang>` says when it starts, so on
 * a site in several languages it starts again when a visitor moves to a page
 * in another one without loading a new page, as Next.js sites do.
 */
function loadPagefind(base: string | undefined): Promise<Pagefind> {
  const language = document.documentElement.lang;
  if (loaded && loadedLanguage !== language) {
    const previous = loaded;
    loaded = previous.then(async (pagefind) => {
      await pagefind.destroy();
      await pagefind.options({ baseUrl: "/" });
      return pagefind;
    });
  }
  loadedLanguage = language;
  loaded ??= (
    import(
      /* @vite-ignore */ /* webpackIgnore: true */ withBase(`/${SEARCH_INDEX_DIR}/pagefind.js`, base)
    ) as Promise<Pagefind>
  ).then(async (pagefind) => {
    // Results' addresses without the site's base path, which SiteLink adds, as for any link.
    await pagefind.options({ baseUrl: "/" });
    return pagefind;
  });
  loaded.catch(() => {
    loaded = undefined;
  });
  return loaded;
}

export interface SearchBoxProps {
  label: string;
  placeholder: string;
  noResults: string;
  unavailable: string;
}

/** A search box with results as you type, from the site's Pagefind index. */
export function SearchBox({ label, placeholder, noResults, unavailable }: SearchBoxProps) {
  const { base } = useSite();
  const id = useId();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Result[]>();
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLElement>(null);
  const input = useRef<HTMLInputElement>(null);

  // Keeps what a visitor typed before the page's scripts loaded.
  useEffect(() => {
    const typed = input.current?.value;
    if (typed) {
      setQuery(typed);
      setOpen(true);
    }
  }, []);

  useEffect(() => {
    const text = query.trim();
    if (!text) {
      setResults(undefined);
      return;
    }
    let current = true;
    loadPagefind(base)
      .then(async (pagefind) => {
        const search = await pagefind.debouncedSearch(text);
        // A newer search replaced this one.
        if (!search || !current) return;
        const found = await Promise.all(search.results.slice(0, 8).map((result) => result.data()));
        if (!current) return;
        setResults(
          found.map((data) => ({
            url: data.url,
            title: data.meta.title || data.url,
            excerpt: excerptHtml(data.excerpt),
          })),
        );
      })
      .catch(() => current && setFailed(true));
    return () => {
      current = false;
    };
  }, [query, base]);

  useEffect(() => {
    const close = (event: Event) => {
      if (event instanceof KeyboardEvent ? event.key === "Escape" : !box.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", close);
    };
  }, []);

  const showing = open && query.trim() !== "";
  return (
    <search ref={box} className="relative block">
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <input
        ref={input}
        id={id}
        type="search"
        autoComplete="off"
        placeholder={placeholder}
        value={query}
        onFocus={() => setOpen(true)}
        onChange={(event) => {
          setQuery(event.target.value);
          setOpen(true);
        }}
        className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-2 focus:outline-primary"
      />
      {showing && (
        <div className="absolute inset-x-0 top-full z-50 mt-2 max-h-[70vh] overflow-y-auto rounded-lg border border-border bg-background p-2 shadow-lg">
          {failed ? (
            <p className="p-2 text-sm text-muted-foreground">{unavailable}</p>
          ) : results && results.length === 0 ? (
            <p className="p-2 text-sm text-muted-foreground">{noResults.replace("{query}", query.trim())}</p>
          ) : (
            <ul className="flex flex-col">
              {results?.map((result) => (
                <li key={result.url}>
                  <SiteLink
                    href={result.url}
                    className="block rounded-md p-2 hover:bg-muted focus-visible:bg-muted"
                    onClick={() => setOpen(false)}
                  >
                    <span className="block font-medium">{result.title}</span>
                    <span
                      className="block text-sm text-muted-foreground"
                      // biome-ignore lint/security/noDangerouslySetInnerHtml: Pagefind's excerpt, with everything but <mark> escaped
                      dangerouslySetInnerHTML={{ __html: result.excerpt }}
                    />
                  </SiteLink>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </search>
  );
}
