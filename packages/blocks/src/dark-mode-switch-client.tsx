"use client";

import { COLOR_SCHEME_ATTRIBUTE, COLOR_SCHEME_STORAGE_KEY } from "@goodfellow-cms/core";
import { cx } from "@goodfellow-cms/react";
import { useEffect, useState } from "react";

type Choice = "light" | "dark" | "system";

export interface ColorSchemeControlProps {
  display: "switch" | "menu";
  showLabels: boolean;
  label: string;
  lightLabel: string;
  darkLabel: string;
  systemLabel: string;
  /** False in the editor, where the switch only shows how it looks. */
  interactive: boolean;
  className: string;
}

function shownChoice(): Choice {
  const value = document.documentElement.getAttribute(COLOR_SCHEME_ATTRIBUTE);
  return value === "light" || value === "dark" ? value : "system";
}

function apply(choice: Choice) {
  const root = document.documentElement;
  if (choice === "system") root.removeAttribute(COLOR_SCHEME_ATTRIBUTE);
  else root.setAttribute(COLOR_SCHEME_ATTRIBUTE, choice);
}

/** Keeps the visitor's choice, which the script at the start of each page puts back (`colorSchemeScript()`). */
function remember(choice: Choice) {
  try {
    if (choice === "system") localStorage.removeItem(COLOR_SCHEME_STORAGE_KEY);
    else localStorage.setItem(COLOR_SCHEME_STORAGE_KEY, choice);
  } catch {
    // Storage can be blocked, as in some private windows: the choice then lasts for this page only.
  }
}

/**
 * The Dark mode switch: a switch between light and dark, or a menu that can
 * also follow the computer's setting. The page's `<html>` says what's shown
 * (`data-gf-color-scheme`), so every switch on the page agrees.
 */
export function ColorSchemeControl({
  display,
  showLabels,
  label,
  lightLabel,
  darkLabel,
  systemLabel,
  interactive,
  className,
}: ColorSchemeControlProps) {
  const [choice, setChoice] = useState<Choice>("system");
  const [computerDark, setComputerDark] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const update = () => setChoice(shownChoice());
    update();
    const observer = new MutationObserver(update);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: [COLOR_SCHEME_ATTRIBUTE] });
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const updateComputer = () => setComputerDark(media.matches);
    updateComputer();
    media.addEventListener("change", updateComputer);
    // A choice made in another tab of the site.
    const onStorage = (event: StorageEvent) => {
      if (!interactive || event.key !== COLOR_SCHEME_STORAGE_KEY) return;
      apply(event.newValue === "light" || event.newValue === "dark" ? event.newValue : "system");
    };
    window.addEventListener("storage", onStorage);
    setReady(true);
    return () => {
      observer.disconnect();
      media.removeEventListener("change", updateComputer);
      window.removeEventListener("storage", onStorage);
    };
  }, [interactive]);

  const choose = (next: Choice) => {
    if (!interactive) return;
    remember(next);
    apply(next);
  };

  if (display === "menu") {
    return (
      <select
        aria-label={label}
        // Until the page's script has started, choosing would do nothing.
        disabled={!ready}
        className={cx("rounded-md border border-border bg-background px-3 py-1.5 text-sm text-foreground", className)}
        value={choice}
        onChange={(event) => choose(event.target.value as Choice)}
      >
        <option value="light">{lightLabel}</option>
        <option value="dark">{darkLabel}</option>
        <option value="system">{systemLabel}</option>
      </select>
    );
  }

  const dark = choice === "dark" || (choice === "system" && computerDark);
  return (
    <button
      type="button"
      role="switch"
      aria-checked={dark}
      aria-label={label}
      title={label}
      disabled={!ready}
      className={cx("inline-flex items-center gap-2 rounded-full text-sm text-foreground", className)}
      onClick={() => choose(dark ? "light" : "dark")}
    >
      {showLabels && <span className={dark ? "text-muted-foreground" : undefined}>{lightLabel}</span>}
      <span className="relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border border-border bg-muted">
        <span
          className={cx(
            "inline-flex h-5 w-5 items-center justify-center rounded-full bg-background text-foreground shadow-sm",
            dark ? "translate-x-5" : "translate-x-0.5",
            ready && "transition-transform",
          )}
        >
          <svg
            viewBox="0 0 24 24"
            width="12"
            height="12"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            aria-hidden="true"
          >
            {dark ? (
              <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
            ) : (
              <>
                <circle cx="12" cy="12" r="4" />
                <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
              </>
            )}
          </svg>
        </span>
      </span>
      {showLabels && <span className={dark ? undefined : "text-muted-foreground"}>{darkLabel}</span>}
    </button>
  );
}
