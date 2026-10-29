import { COPY_ATTRIBUTE } from "@goodfellow-cms/core";

/**
 * Copies a code block's text, with `copyScript()` from `@goodfellow-cms/core`,
 * which copies the `<pre>` in the `<figure>` it's in. Its label is the
 * block's, so sites in other languages can translate it, and its classes come
 * from `CodeView`, with the theme's. While it shows it copied, the script
 * marks it `data-gf-copied`, which swaps its icons.
 */
export function CopyButton({ label, className }: { label: string; className: string }) {
  return (
    <button type="button" title={label} aria-label={label} className={className} {...{ [COPY_ATTRIBUTE]: "" }}>
      <svg
        className="[[data-gf-copied]_&]:hidden"
        viewBox="0 0 24 24"
        width="16"
        height="16"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        aria-hidden="true"
      >
        <rect x="9" y="9" width="13" height="13" rx="2" />
        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
      </svg>
      <svg
        className="hidden [[data-gf-copied]_&]:block"
        viewBox="0 0 24 24"
        width="16"
        height="16"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        aria-hidden="true"
      >
        <path d="M20 6 9 17l-5-5" />
      </svg>
    </button>
  );
}
