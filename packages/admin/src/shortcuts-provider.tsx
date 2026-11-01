import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { useAdmin, useCanChangeSettings } from "./admin-context.js";
import { navigate } from "./router.js";
import { SETTINGS_ITEMS } from "./settings-sidebar.js";
import {
  findPlaces,
  type GoToPlace,
  goToPlaces,
  isTyping,
  onShortcut,
  type Shortcut,
  shortcutFor,
  usesCommandKey,
} from "./shortcuts.js";
import { type StringKey, useStrings } from "./strings.js";
import { Button, Dialog } from "./ui.js";

/** What a screen does for the shortcuts that depend on it. */
export type ShortcutHandlers = Partial<Record<"save" | "undo" | "redo", () => void>>;

interface ShortcutsValue {
  register(handlers: { current: ShortcutHandlers }): () => void;
}

const ShortcutsContext = createContext<ShortcutsValue | null>(null);

/** Lets the screen showing handle Ctrl+S, Ctrl+Z and Ctrl+Y (⌘ on a Mac) while it's open. */
export function useShortcutHandlers(handlers: ShortcutHandlers): void {
  const shortcuts = useContext(ShortcutsContext);
  const latest = useRef(handlers);
  latest.current = handlers;
  useEffect(() => shortcuts?.register(latest), [shortcuts]);
}

function commandKey(): boolean {
  if (typeof navigator === "undefined") return false;
  const platform = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform;
  return usesCommandKey(platform || navigator.platform || navigator.userAgent);
}

/**
 * The admin panel's keyboard shortcuts: the Go to box (Ctrl+K) and the list
 * of shortcuts (`?`) everywhere, and what the screen showing registers.
 */
export function ShortcutsProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState<"goTo" | "help">();
  const stack = useRef<Array<{ current: ShortcutHandlers }>>([]);

  /** Runs a shortcut; whether it did anything, so the browser's own is kept away. */
  const run = useCallback((shortcut: Shortcut): boolean => {
    if (shortcut === "goTo" || shortcut === "help") {
      setOpen(shortcut);
      return true;
    }
    const handler = stack.current.at(-1)?.current[shortcut];
    if (handler) {
      handler();
      return true;
    }
    // Nothing to add to a draft here, but the browser's "Save page" would only confuse.
    return shortcut === "save";
  }, []);

  useEffect(() => {
    const stop = onShortcut((shortcut) => void run(shortcut));
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      const shortcut = shortcutFor(event, isTyping(event.target));
      if (shortcut && run(shortcut)) event.preventDefault();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      stop();
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [run]);

  const value = useMemo<ShortcutsValue>(
    () => ({
      register(handlers) {
        stack.current.push(handlers);
        return () => {
          stack.current = stack.current.filter((entry) => entry !== handlers);
        };
      },
    }),
    [],
  );

  return (
    <ShortcutsContext.Provider value={value}>
      {children}
      {open === "goTo" && <GoToDialog onClose={() => setOpen(undefined)} />}
      {open === "help" && <ShortcutsDialog onClose={() => setOpen(undefined)} />}
    </ShortcutsContext.Provider>
  );
}

const KINDS: Record<GoToPlace["kind"], StringKey> = {
  screen: "goTo.kind.screen",
  settings: "goTo.kind.settings",
  page: "goTo.kind.page",
  item: "goTo.kind.item",
  collection: "goTo.kind.collection",
  synced: "goTo.kind.synced",
};

/** The screens the person may open, as the header and Site Settings' sidebar list them. */
function useScreens(): GoToPlace[] {
  const t = useStrings();
  const { site, contentOnly } = useAdmin();
  const owner = useCanChangeSettings();
  return useMemo(() => {
    const screens: GoToPlace[] = [
      { kind: "screen", label: t("nav.pages"), href: "#/pages" },
      { kind: "screen", label: t("nav.collections"), href: "#/collections" },
      { kind: "screen", label: t("nav.media"), href: "#/media" },
      { kind: "screen", label: t("layout.header"), href: "#/layout/header" },
      { kind: "screen", label: t("layout.footer"), href: "#/layout/footer" },
      { kind: "screen", label: t("nav.synced"), href: "#/synced-blocks" },
    ];
    if (!owner) return screens;
    if (!contentOnly) screens.push({ kind: "screen", label: t("nav.blocks"), href: "#/blocks" });
    for (const item of SETTINGS_ITEMS) {
      screens.push({ kind: "settings", label: t(item.label), href: `#/settings/${item.place}` });
    }
    for (const plugin of site.description.plugins ?? []) {
      for (const screen of plugin.screens ?? []) {
        screens.push({
          kind: "settings",
          label: screen.title,
          href: `#/settings/plugin/${encodeURIComponent(plugin.id)}/${encodeURIComponent(screen.id)}`,
        });
      }
    }
    return screens;
  }, [t, owner, contentOnly, site.description.plugins]);
}

/** Ctrl+K: finds a page, item or screen by what's typed, and goes there. */
function GoToDialog({ onClose }: { onClose: () => void }) {
  const t = useStrings();
  const { state } = useAdmin();
  const screens = useScreens();
  const places = useMemo(
    () => (state.status === "ready" ? goToPlaces(state.content, screens) : screens),
    [state, screens],
  );
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const found = useMemo(() => findPlaces(places, query), [places, query]);
  const listId = useId();
  const optionId = (index: number) => `${listId}-${index}`;
  const current = Math.min(active, Math.max(found.length - 1, 0));
  // The option chosen with the arrow keys stays in view.
  useEffect(() => {
    document.getElementById(optionId(current))?.scrollIntoView({ block: "nearest" });
  });

  const go = (place: GoToPlace | undefined) => {
    if (!place) return;
    onClose();
    navigate(place.href, () => window.confirm(t("unsaved.confirm")));
  };

  return (
    <Dialog title={t("goTo.title")} onClose={onClose}>
      <div className="gfa-goto">
        <input
          autoFocus
          type="search"
          role="combobox"
          aria-label={t("goTo.label")}
          aria-expanded={found.length > 0}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={found.length > 0 ? optionId(current) : undefined}
          placeholder={t("goTo.placeholder")}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setActive(0);
          }}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setActive(Math.min(current + 1, found.length - 1));
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              setActive(Math.max(current - 1, 0));
            } else if (event.key === "Enter") {
              event.preventDefault();
              go(found[current]);
            }
          }}
        />
        {found.length === 0 ? (
          <p className="gfa-hint">{t("goTo.empty")}</p>
        ) : (
          <div id={listId} role="listbox" aria-label={t("goTo.label")} className="gfa-goto-list">
            {found.map((place, index) => (
              // The list is driven from the box, as a combobox's is, so options don't take focus themselves.
              // biome-ignore lint/a11y/useKeyWithClickEvents: the box's arrow keys and Enter choose options.
              <div
                key={`${place.kind}:${place.href}`}
                id={optionId(index)}
                role="option"
                tabIndex={-1}
                aria-selected={index === current}
                className="gfa-goto-option"
                onMouseDown={(event) => event.preventDefault()}
                onMouseMove={() => setActive(index)}
                onClick={() => go(place)}
              >
                <span className="gfa-goto-label">{place.label}</span>
                <span className="gfa-hint">
                  {t(KINDS[place.kind])}
                  {place.detail && ` · ${place.detail}`}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </Dialog>
  );
}

/** `?`: what each shortcut does, naming ⌘ on a Mac and Ctrl elsewhere. */
function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  const t = useStrings();
  const mod = commandKey() ? "⌘" : "Ctrl";
  const rows: Array<{ keys: string[][]; label: StringKey }> = [
    { keys: [[mod, "S"]], label: "shortcuts.save" },
    { keys: [[mod, "Z"]], label: "shortcuts.undo" },
    {
      keys: [
        [mod, "Shift", "Z"],
        [mod, "Y"],
      ],
      label: "shortcuts.redo",
    },
    { keys: [[mod, "K"]], label: "shortcuts.goTo" },
    { keys: [["?"]], label: "shortcuts.help" },
  ];
  return (
    <Dialog title={t("shortcuts.title")} onClose={onClose}>
      <table className="gfa-shortcuts">
        <tbody>
          {rows.map((row) => (
            <tr key={row.label}>
              <td>
                {row.keys.map((combination, index) => (
                  <span key={combination.join("+")}>
                    {index > 0 && ` ${t("shortcuts.or")} `}
                    {combination.map((key, keyIndex) => (
                      <span key={key}>
                        {keyIndex > 0 && "+"}
                        <kbd>{key}</kbd>
                      </span>
                    ))}
                  </span>
                ))}
              </td>
              <td>{t(row.label)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="gfa-hint">{t("shortcuts.typing")}</p>
      <div className="gfa-dialog-actions">
        <Button variant="primary" onClick={onClose}>
          {t("action.close")}
        </Button>
      </div>
    </Dialog>
  );
}
