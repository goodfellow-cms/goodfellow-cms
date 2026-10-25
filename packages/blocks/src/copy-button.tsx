"use client";

import { useEffect, useState } from "react";

/**
 * Copies a code block's text. Its label is the block's, so sites in other
 * languages can translate it, and its classes come from `CodeView`, with the theme's.
 */
export function CopyButton({ code, label, className }: { code: string; label: string; className: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      className={className}
      onClick={() => {
        void navigator.clipboard?.writeText(code).then(() => setCopied(true));
      }}
    >
      <svg
        viewBox="0 0 24 24"
        width="16"
        height="16"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        aria-hidden="true"
      >
        {copied ? (
          <path d="M20 6 9 17l-5-5" />
        ) : (
          <>
            <rect x="9" y="9" width="13" height="13" rx="2" />
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
          </>
        )}
      </svg>
    </button>
  );
}
