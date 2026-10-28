import { useEffect, useSyncExternalStore } from "react";

/** How the admin panel looks: like the computer's setting, or always light or dark. */
export type ThemeChoice = "system" | "light" | "dark";

const KEY = "goodfellow-admin-theme";
const listeners = new Set<() => void>();

function read(): ThemeChoice {
  try {
    const saved = localStorage.getItem(KEY);
    return saved === "light" || saved === "dark" ? saved : "system";
  } catch {
    return "system";
  }
}

let current: ThemeChoice | undefined;

function choice(): ThemeChoice {
  current ??= read();
  return current;
}

/** Shows the choice: the stylesheet's colors follow `data-gfa-theme`, or the computer's setting without it. */
function apply(next: ThemeChoice) {
  const root = document.documentElement;
  if (next === "system") delete root.dataset.gfaTheme;
  else root.dataset.gfaTheme = next;
}

export function setThemeChoice(next: ThemeChoice) {
  current = next;
  try {
    if (next === "system") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, next);
  } catch {
    // Without storage, the choice lasts until the page is closed.
  }
  apply(next);
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  const media = matchMedia("(prefers-color-scheme: dark)");
  media.addEventListener("change", listener);
  return () => {
    listeners.delete(listener);
    media.removeEventListener("change", listener);
  };
}

/**
 * Makes the admin panel dark or light, as its dark mode switch does. Choosing
 * what the computer's setting already gives follows that setting again, so
 * the admin panel changes with the computer, as it did before anyone chose.
 */
export function setDarkMode(dark: boolean) {
  const computer = matchMedia("(prefers-color-scheme: dark)").matches;
  setThemeChoice(dark === computer ? "system" : dark ? "dark" : "light");
}

/** The choice, kept in this browser. */
export function useThemeChoice(): ThemeChoice {
  return useSyncExternalStore(subscribe, choice, () => "system" as const);
}

/** Applies the choice to the page while the admin panel is open. Used once, by the admin panel itself. */
export function useApplyThemeChoice(): void {
  const value = useThemeChoice();
  useEffect(() => {
    apply(value);
    return () => {
      delete document.documentElement.dataset.gfaTheme;
    };
  }, [value]);
}

/** Whether the admin panel is dark at the moment, by choice or by the computer's setting. */
export function useDarkMode(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => {
      const value = choice();
      return value === "dark" || (value === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
    },
    () => false,
  );
}
