/**
 * Editor plugins in the admin panel: a plugin's page editor drawn in its own
 * frame in place of Puck's, for whoever chooses it, which is given what's
 * edited and hands it back. The editor's header, Publish and the AI assistant
 * stay the admin panel's own (`PuckEditor`), which checks what comes back
 * with `checkEditedData()` before publishing.
 */
import {
  type Collection,
  contentInLanguage,
  getPageHead,
  googleFontsUrl,
  type PageFile,
  type PluginDescription,
  type PluginEditorBlock,
  type PluginEditorData,
  type PluginEditorKind,
  type PluginSharePreview,
  pageLinks,
  pathLanguage,
  type SiteDescription,
  themeToCss,
} from "@goodfellow-cms/core";
import type { Data } from "@puckeditor/core";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAdmin, useSiteContent } from "./admin-context.js";
import type { Channel } from "./frame/channel.js";
import { useFrameServices } from "./frame/host.js";
import type { PluginFrameEditorOpen, PluginFrameEditorOpened } from "./frame/plugin-protocol.js";
import { type PluginEditorHooks, usePluginFrame, usePluginHost } from "./plugin-frames.js";
import { useStrings } from "./strings.js";
import { ErrorMessage } from "./ui.js";

/** Where each browser remembers the editor its person chose: an editor plugin's name, or nothing for the usual one. */
const EDITOR_CHOICE_KEY = "goodfellow-editor";

/** The site's editor plugins that edit a kind of page. Items' fields are always edited in Puck. */
export function editorPlugins(description: SiteDescription, kind: string): PluginDescription[] {
  return (description.plugins ?? []).filter(
    (plugin) => plugin.admin && plugin.editor?.kinds.includes(kind as PluginEditorKind),
  );
}

function readChoice(): string | undefined {
  try {
    return localStorage.getItem(EDITOR_CHOICE_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

function writeChoice(name: string | undefined) {
  try {
    if (name) localStorage.setItem(EDITOR_CHOICE_KEY, name);
    else localStorage.removeItem(EDITOR_CHOICE_KEY);
  } catch {
    // Without storage, the choice lasts until the page is left.
  }
}

/** The editor plugins offered for a kind of page, the one chosen in this browser if it's one of them, and choosing. */
export function useEditorChoice(
  description: SiteDescription,
  kind: string,
): { plugins: PluginDescription[]; chosen?: PluginDescription; choose(name: string | undefined): void } {
  const plugins = useMemo(() => editorPlugins(description, kind), [description, kind]);
  const [name, setName] = useState(readChoice);
  const choose = useCallback((next: string | undefined) => {
    writeChoice(next);
    setName(next);
  }, []);
  return { plugins, chosen: plugins.find((plugin) => plugin.name === name), choose };
}

/** What an editor plugin is told about what it opens, from the site as it's loaded. */
export interface PluginEditorTarget {
  kind: PluginEditorKind;
  path: string;
  title: string;
  language?: string;
  collection?: Collection;
}

/** What the admin panel's header can ask an open editor plugin. */
export interface PluginEditorHandle {
  /** What's edited now, as Publish publishes it. */
  data(): Promise<Data>;
  /** Replaces what's edited, where the editor takes changes from outside. */
  set?: (data: Data) => Promise<void>;
  undo?: () => void;
  redo?: () => void;
}

/** What an editor plugin said last about what's edited. */
export interface PluginEditorChange {
  data: Data;
  past: boolean;
  future: boolean;
  selected: string | null;
}

/** An editor plugin's page editor, in a frame of its own sized like Puck's. */
export function PluginEditorFrame({
  plugin,
  target,
  data,
  onOpen,
  onChange,
}: {
  plugin: PluginDescription;
  target: PluginEditorTarget;
  /** What it opens with, read each time its frame starts. */
  data: () => Data;
  /** It opened with what `data` gave, and here's what it can do. */
  onOpen: (handle: PluginEditorHandle, opened: Data) => void;
  onChange: (change: PluginEditorChange) => void;
}) {
  const t = useStrings();
  const host = usePluginHost();
  const services = useFrameServices();
  const { content } = useSiteContent();
  const { site, code, preview } = useAdmin();
  const { description } = site;
  const { themeCss } = preview;
  const latest = useRef({ target, data, onOpen, onChange, content, description, services, code, themeCss });
  latest.current = { target, data, onOpen, onChange, content, description, services, code, themeCss };
  const opening = useRef<Data | undefined>(undefined);
  // Until it says it's open, which can take a while for an editor as big as Gutenberg, it shows it's on its way.
  const [ready, setReady] = useState(false);

  const hooks = useMemo<PluginEditorHooks>(
    () => ({
      open: () => {
        const { target, data, content, description } = latest.current;
        const opened = data();
        opening.current = opened;
        setReady(false);
        return editorOpen(target, opened, content, description);
      },
      onOpened: (opened: PluginFrameEditorOpened, channel: Channel) => {
        setReady(true);
        latest.current.onOpen(editorHandle(opened, channel), opening.current ?? latest.current.data());
      },
      onChange: ({ data, state }) => {
        latest.current.onChange({
          data: data as Data,
          past: state?.past === true,
          future: state?.future === true,
          selected: state?.selected ?? null,
        });
      },
      chooseMedia: (kind, value) => latest.current.services.chooseMedia(kind, value),
      sharePreview: (root) => sharePreview(latest.current.content, latest.current.target.path, root),
      draw: (block: PluginEditorBlock) => {
        const { target, content, description, code } = latest.current;
        if (!editorBlocks(target, description)[block.type]) {
          return Promise.reject(new Error(`${block.type} isn't one of the blocks this editor may use.`));
        }
        return code.drawBlock(content, { kind: target.kind, path: target.path, block });
      },
      mediaBytes: (url) => latest.current.services.mediaPreviews.bytes(url),
      onRemember: (listener) => latest.current.services.mediaPreviews.onRemember(listener),
      mediaStorage: () => latest.current.content.mediaStorage,
      // As the site's last build compiled them, with the theme and custom CSS as they are now, which may not be published yet.
      styles: async () => {
        const { services, content, themeCss } = latest.current;
        const fonts = googleFontsUrl(content.settings.theme);
        return {
          stylesheets: [...(await services.siteCss()), themeToCss(content.settings.theme)],
          tailwind: `${themeCss}\n${content.customCss}`,
          ...(fonts && { fonts }),
        };
      },
    }),
    [],
  );
  const { channel, failed, frameProps } = usePluginFrame(plugin, host, "editor", undefined, hooks);
  // Files a plugin keeps outside the repository, which the frame shows from their storage, as they change.
  const storage = content.mediaStorage;
  useEffect(() => {
    void channel?.call("media.storage", storage ?? null).catch(() => {});
  }, [channel, storage]);
  const name = plugin.editor?.title ?? plugin.title;
  if (failed) return <ErrorMessage message={t("editor.plugin.failed", { editor: name })} />;
  return (
    <div className="gfa-plugin-editor-wrap">
      <iframe className="gfa-editor-frame" title={t("editor.frame", { title: target.title })} {...frameProps} />
      {!ready && (
        <div className="gfa-editor-loading" role="status">
          <span className="gfa-spinner" aria-hidden="true" />
          {t("editor.plugin.loading", { editor: name })}
        </div>
      )}
    </div>
  );
}

/** What the header asks the editor's frame for, as far as it said it can. */
function editorHandle(opened: PluginFrameEditorOpened, channel: Channel): PluginEditorHandle {
  return {
    data: async () => (await channel.call("editor.data")) as Data,
    ...(opened.set && {
      set: async (data: Data) => {
        await channel.call("editor.set", data);
      },
    }),
    ...(opened.undo && {
      undo: () => void channel.call("editor.undo").catch(() => {}),
      redo: () => void channel.call("editor.redo").catch(() => {}),
    }),
  };
}

/** The blocks an editor plugin may use for what it edits: all but those only templates have, except in templates. */
function editorBlocks(target: PluginEditorTarget, description: SiteDescription): SiteDescription["blocks"] {
  return Object.fromEntries(
    Object.entries(description.blocks).filter(([, block]) => target.kind === "template" || !block.templateOnly),
  );
}

/** What an editor plugin opens: what's edited, the blocks it may use and the site around it. */
function editorOpen(
  target: PluginEditorTarget,
  data: Data,
  content: ReturnType<typeof useSiteContent>["content"],
  description: SiteDescription,
): PluginFrameEditorOpen {
  const layout = target.kind === "header" || target.kind === "footer";
  const language = target.language ?? pathLanguage(content.settings, target.path);
  const blocks = editorBlocks(target, description);
  return {
    kind: target.kind,
    path: target.path,
    title: target.title,
    ...(target.language && { language: target.language }),
    data: data as PluginEditorData,
    blocks,
    root: { fields: layout ? {} : description.root.fields },
    ...(target.kind === "template" &&
      target.collection && {
        collection: {
          id: target.collection.id,
          name: target.collection.settings.name,
          fields: target.collection.settings.fields.map(({ name, label, type }) => ({ name, label, type })),
        },
      }),
    settings: content.settings,
    pages: pageLinks(contentInLanguage(content, language)),
  };
}

/** How a link to the page looks when it's shared, as the page editor's own preview shows it. */
function sharePreview(
  content: ReturnType<typeof useSiteContent>["content"],
  path: string,
  root: unknown,
): PluginSharePreview {
  const props = typeof root === "object" && root !== null ? ((root as { props?: unknown }).props ?? {}) : {};
  const page = {
    path,
    file: "",
    content: { version: 1, data: { root: { props }, content: [] } } as unknown as PageFile,
  };
  const head = getPageHead(content.settings, page);
  const { url } = content.settings;
  return {
    title: head.title,
    ...(head.description && { description: head.description }),
    ...(head.socialImage && { image: head.socialImage }),
    ...(url && { host: new URL(url).hostname }),
    noIndex: Boolean(head.noIndex),
  };
}
