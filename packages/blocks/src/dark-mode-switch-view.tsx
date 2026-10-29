import { DARK_MODE_ATTRIBUTE } from "@goodfellow-cms/core";
import { useParts } from "@goodfellow-cms/react";

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

/**
 * The Dark mode switch: a switch between light and dark, or a menu that can
 * also follow the computer's setting, which `darkModeScript()` from
 * `@goodfellow-cms/core` makes work. Until it runs, the switch is disabled,
 * since choosing would do nothing, and it then says what's shown. On the
 * site it's marked with `DARK_MODE_ATTRIBUTE`; in the editor it isn't, and
 * only shows how it looks.
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
  const part = useParts();
  // The script enables it and sets what it shows, which React, taking over a Next.js page, leaves as it is.
  const live = interactive ? { [DARK_MODE_ATTRIBUTE]: display, disabled: true, suppressHydrationWarning: true } : {};

  if (display === "menu") {
    return (
      <select
        aria-label={label}
        className={part(
          "gf-dark-mode-switch",
          "rounded-md border border-border bg-background px-3 py-1.5 text-sm text-foreground",
          // A menu can't be set by CSS, so where the visitor has chosen light or dark it's hidden until its
          // script shows their choice, rather than showing "Follow my computer" first.
          interactive && "[[data-gf-color-scheme]_&:not([data-gf-ready])]:invisible",
          className,
        )}
        defaultValue="system"
        {...live}
      >
        <option value="light">{lightLabel}</option>
        <option value="dark">{darkLabel}</option>
        <option value="system">{systemLabel}</option>
      </select>
    );
  }

  // What the switch shows comes from CSS (`dark:`), which knows the page's colors before it's shown, rather
  // than from its script, which only knows once it has run.
  return (
    <button
      type="button"
      role="switch"
      aria-checked={false}
      aria-label={label}
      title={label}
      className={part(
        "gf-dark-mode-switch",
        "inline-flex items-center gap-2 rounded-full text-sm text-foreground",
        className,
      )}
      {...live}
    >
      {showLabels && <span className="dark:text-muted-foreground">{lightLabel}</span>}
      <span
        className={part(
          "gf-dark-mode-switch-track",
          "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border border-border bg-muted",
        )}
      >
        <span
          className={part(
            "gf-dark-mode-switch-thumb",
            "inline-flex h-5 w-5 items-center justify-center rounded-full bg-background text-foreground shadow-sm transition-transform",
            "translate-x-0.5 dark:translate-x-5",
          )}
        >
          <svg
            className="dark:hidden"
            viewBox="0 0 24 24"
            width="12"
            height="12"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            aria-hidden="true"
          >
            <circle cx="12" cy="12" r="4" />
            <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
          </svg>
          <svg
            className="hidden dark:block"
            viewBox="0 0 24 24"
            width="12"
            height="12"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            aria-hidden="true"
          >
            <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
          </svg>
        </span>
      </span>
      {showLabels && <span className="text-muted-foreground dark:text-foreground">{darkLabel}</span>}
    </button>
  );
}
