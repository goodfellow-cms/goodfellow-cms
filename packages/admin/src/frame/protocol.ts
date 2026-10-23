/**
 * What the admin panel and the site's frames say to each other. The admin
 * panel's page is trusted: it signs in and publishes. Frames run the site's
 * config, Puck and every block, sandboxed without `allow-same-origin`, so they
 * get only what's in these messages and can only ask for the few things below.
 */
import type {
  Page,
  PageView,
  RepositoryVisibility,
  ScheduledBuildTiming,
  SiteContent,
  SiteProblem,
} from "@goodfellow-cms/core";
import type { MediaFieldKind } from "@goodfellow-cms/react";
import type { ComponentData, Config, Data, UiState } from "@puckeditor/core";
import type { PreviewOptions } from "../admin-context.js";
import type { PreviewScheme } from "../preview.js";
import type { RenderTarget } from "../site-code.js";
import type { Strings } from "../strings.js";
import type { ThemeChoice } from "../theme.js";

/** What a frame is for: one editor, previews of pages, or answering for the site's code. */
export type FrameMode = "editor" | "render" | "code";

/** A frame sends this to the admin panel's page once it's listening, and the page answers with a port. */
export const READY_MESSAGE = "goodfellow:frame-ready";

/** The site as it's loaded, which the frame shows and works with. */
export interface FrameSite {
  content: SiteContent;
  /** The media library's files, as `public/media/…` paths. */
  media: string[];
  /** When scheduled changes go live, and who can read the repository, once the backend has said. */
  schedule: { timing?: ScheduledBuildTiming; visibility?: RepositoryVisibility; syncProblem?: "not-allowed" };
}

/** Everything a frame starts with (`init`). */
export interface FrameInit extends FrameSite {
  mode: FrameMode;
  /** The live site's address, for showing media. */
  siteUrl: string;
  preview: PreviewOptions;
  /**
   * The site's compiled CSS as text, for the editor, which scopes it to the
   * canvas, since the editor's own controls share its page.
   */
  siteCss?: string[];
  strings: Strings;
  theme: ThemeChoice;
  /** The git host's name, for notes such as when scheduled changes go live. */
  hostName: string;
}

/** Which editor to open (`editor.open`). */
export interface EditorOpen {
  kind: "page" | "header" | "footer" | "template" | "entry";
  /** The page's address, or the language's home for the header and footer. */
  path: string;
  title: string;
  data: Data;
  /** The collection whose template or item is being edited. */
  collection?: string;
  /** The item being edited. */
  entry?: string;
  /** The language of what's edited, on a site in several languages. */
  language?: string;
  /** Puck's sidebars, as the editor last left them. */
  ui?: Partial<UiState>;
}

/** What the editor tells the admin panel about itself once it's open. */
export interface EditorOpened {
  /** Puck's config as JSON, for the AI assistant: blocks' and settings' fields, without their code. */
  config: Config;
}

/** Puck's state as the admin panel's header shows it (`editor.state` events). */
export interface EditorState {
  data: Data;
  selected: ComponentData | null;
  /** Whether there's something to undo, and to redo. */
  past: boolean;
  future: boolean;
  leftSideBarVisible: boolean;
  rightSideBarVisible: boolean;
  leftSideBarWidth?: number | null;
  rightSideBarWidth?: number | null;
}

/** A change the AI assistant makes to what's being edited, where Undo can take it back (`editor.apply`). */
export type EditorChange =
  | { type: "root"; props: Record<string, unknown> }
  | { type: "translate"; props: Record<string, unknown>; content: ComponentData[] }
  | { type: "replace"; id: string; block: ComponentData }
  | { type: "append"; blocks: ComponentData[] };

/** A page to preview (`render.show`): the one at `path` in `content`. */
export interface RenderShow {
  content: SiteContent;
  path: string;
  /** Light or dark, for sites with dark mode. */
  scheme?: PreviewScheme;
}

/** How showing a page went: its status (404 for "Page not found"), and how tall it is. */
export type RenderShown = { ok: true; status: number; height: number } | { ok: false; problem: string };

/** The requests the admin panel's page answers for frames. */
export interface AdminRequests {
  /** Goes to another screen of the admin panel, such as from a block's note: only `#/…` addresses. */
  navigate(href: string): void;
  /** Opens the media library for a field; answers with the address chosen, or `null`. */
  "media.choose"(params: { kind: MediaFieldKind; value: string }): string | null;
  /** A media file's bytes, for one the live site doesn't have yet. Only `/media/…` addresses. */
  "media.bytes"(url: string): Uint8Array | null;
}

/** The requests frames answer for the admin panel's page. */
export interface FrameRequests {
  init(init: FrameInit): void;
  site(site: FrameSite): void;
  theme(theme: ThemeChoice): void;
  "editor.open"(open: EditorOpen): EditorOpened;
  /** What's being edited now, as Publish publishes it. */
  "editor.data"(): Data;
  "editor.undo"(): void;
  "editor.redo"(): void;
  "editor.ui"(ui: Partial<Pick<UiState, "leftSideBarVisible" | "rightSideBarVisible">>): void;
  /** The canvas's width, to preview a page on a phone or tablet; `null` fills the editor. */
  "editor.viewport"(width: number | null): void;
  "editor.apply"(change: EditorChange): void;
  "render.show"(show: RenderShow): RenderShown;
  "code.sitePages"(params: { content: SiteContent; today: string }): Page[];
  "code.pageView"(params: { page: Page; content: SiteContent; today: string }): PageView | null;
  "code.renderedProblems"(params: { content: SiteContent; targets: RenderTarget[]; today: string }): SiteProblem[];
}

/** Events frames send the admin panel's page. */
export interface FrameEvents {
  "editor.state": EditorState;
  /** How tall the page a render frame shows is, whenever that changes. */
  "render.height": number;
}
