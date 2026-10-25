import {
  Braces,
  CodeXml,
  FileInput,
  Globe,
  History,
  Languages,
  type LucideIcon,
  Menu,
  Palette,
  PanelLeftClose,
  PanelLeftOpen,
  RefreshCw,
  Settings,
  ShieldCheck,
  Signpost,
  Users,
} from "lucide-react";
import { useState, useSyncExternalStore } from "react";
import { type StringKey, useStrings } from "./strings.js";
import { AppLink } from "./use-link.js";

/** Site Settings' tabs: the ones published together from one form, then screens of their own. */
export type SettingsPlace =
  | "general"
  | "languages"
  | "theme"
  | "menus"
  | "redirects"
  | "css"
  | "code"
  | "domain"
  | "editors"
  | "updates"
  | "history"
  | "import"
  | "security";

interface SidebarItem {
  place: SettingsPlace;
  label: StringKey;
  icon: LucideIcon;
}

/** The form's tabs, which share one Publish, so moving between them keeps unpublished changes. */
const FORM_ITEMS: SidebarItem[] = [
  { place: "general", label: "settings.tab.general", icon: Settings },
  { place: "languages", label: "settings.tab.languages", icon: Languages },
  { place: "theme", label: "settings.tab.theme", icon: Palette },
  { place: "menus", label: "settings.tab.menus", icon: Menu },
  { place: "redirects", label: "settings.tab.redirects", icon: Signpost },
  { place: "css", label: "settings.tab.css", icon: Braces },
  { place: "code", label: "settings.tab.code", icon: CodeXml },
];

/** Screens of their own, which ask before leaving unpublished changes, as leaving any screen does. */
const SCREEN_ITEMS: SidebarItem[] = [
  { place: "domain", label: "settings.tab.domain", icon: Globe },
  { place: "editors", label: "settings.tab.editors", icon: Users },
  { place: "updates", label: "settings.tab.updates", icon: RefreshCw },
  { place: "history", label: "settings.tab.history", icon: History },
  { place: "import", label: "settings.tab.import", icon: FileInput },
  { place: "security", label: "settings.tab.security", icon: ShieldCheck },
];

const COLLAPSED_KEY = "goodfellow.settingsSidebar";

/** Narrower than this, the sidebar shows only its icons, leaving the room to the tab. */
const NARROW = "(max-width: 720px)";

function subscribeNarrow(onChange: () => void): () => void {
  const query = window.matchMedia(NARROW);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

function useNarrow(): boolean {
  return useSyncExternalStore(
    subscribeNarrow,
    () => window.matchMedia(NARROW).matches,
    () => false,
  );
}

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSED_KEY) === "collapsed";
  } catch {
    return false;
  }
}

function writeCollapsed(collapsed: boolean): void {
  try {
    if (collapsed) localStorage.setItem(COLLAPSED_KEY, "collapsed");
    else localStorage.removeItem(COLLAPSED_KEY);
  } catch {
    // Without storage, it's open again next time.
  }
}

/**
 * Site Settings' tabs as a sidebar, each with its icon. Collapsed, it shows
 * only the icons, with each name in a tooltip, and remembers that in this browser.
 */
export function SettingsSidebar({ current }: { current: SettingsPlace }) {
  const t = useStrings();
  const [chosen, setChosen] = useState(readCollapsed);
  const narrow = useNarrow();
  const collapsed = chosen || narrow;
  const toggle = () => {
    writeCollapsed(!chosen);
    setChosen(!chosen);
  };
  const item = ({ place, label, icon: Icon }: SidebarItem, form: boolean) => {
    const props = {
      href: `#/settings/${place}`,
      className: "gfa-sidebar-item",
      "aria-current": place === current ? ("page" as const) : undefined,
    };
    const inner = (
      <>
        <Icon className="gfa-sidebar-icon" size={18} strokeWidth={1.75} aria-hidden="true" />
        <span className="gfa-sidebar-label">{t(label)}</span>
      </>
    );
    return <li key={place}>{form ? <a {...props}>{inner}</a> : <AppLink {...props}>{inner}</AppLink>}</li>;
  };
  return (
    <nav className="gfa-sidebar" data-collapsed={collapsed || undefined} aria-label={t("settings.title")}>
      <ul className="gfa-sidebar-list">{FORM_ITEMS.map((entry) => item(entry, true))}</ul>
      <hr className="gfa-sidebar-divider" />
      <ul className="gfa-sidebar-list">{SCREEN_ITEMS.map((entry) => item(entry, false))}</ul>
      {/* In a narrow window there's no room for the names. */}
      {!narrow && (
        <button
          type="button"
          className="gfa-sidebar-item gfa-sidebar-toggle"
          aria-expanded={!collapsed}
          onClick={toggle}
        >
          {collapsed ? (
            <PanelLeftOpen className="gfa-sidebar-icon" size={18} strokeWidth={1.75} aria-hidden="true" />
          ) : (
            <PanelLeftClose className="gfa-sidebar-icon" size={18} strokeWidth={1.75} aria-hidden="true" />
          )}
          <span className="gfa-sidebar-label">
            {t(collapsed ? "settings.sidebar.expand" : "settings.sidebar.collapse")}
          </span>
        </button>
      )}
    </nav>
  );
}
