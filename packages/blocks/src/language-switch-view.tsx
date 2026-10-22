import type { LanguageLink } from "@goodfellow-cms/core";
import { cx, SiteLink } from "@goodfellow-cms/react";

export interface LanguageListProps {
  links: LanguageLink[];
  display: "links" | "menu";
  label: string;
  className: string;
}

/** The Language switch's links, side by side or in a menu that opens, each language named in itself. */
export function LanguageList({ links, display, label, className }: LanguageListProps) {
  const current = links.find((language) => language.current) ?? links[0];
  const items = links.map((language) => (
    <li key={language.code}>
      <SiteLink
        href={language.path}
        hrefLang={language.code}
        lang={language.code}
        aria-current={language.current ? "true" : undefined}
        className={cx(
          "block rounded-md px-2 py-1 text-sm hover:bg-muted",
          language.current ? "font-semibold text-foreground" : "text-muted-foreground hover:text-foreground",
        )}
      >
        {language.name}
      </SiteLink>
    </li>
  ));
  if (display === "menu") {
    return (
      <nav aria-label={label} className={cx("relative inline-block", className)}>
        <details className="group">
          <summary
            lang={current?.code}
            className="flex cursor-pointer list-none items-center gap-1 rounded-md px-2 py-1 text-sm hover:bg-muted [&::-webkit-details-marker]:hidden"
          >
            {current?.name}
            <span aria-hidden="true" className="text-xs transition-transform group-open:rotate-180">
              ▾
            </span>
          </summary>
          <ul className="absolute right-0 z-10 mt-1 min-w-40 rounded-md border border-border bg-background p-1 shadow-md">
            {items}
          </ul>
        </details>
      </nav>
    );
  }
  return (
    <nav aria-label={label} className={className || undefined}>
      <ul className="flex flex-wrap items-center gap-1">{items}</ul>
    </nav>
  );
}
