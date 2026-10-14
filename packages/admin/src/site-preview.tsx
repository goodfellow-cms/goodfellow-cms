/**
 * The page tools such as the Claude connector take screenshots of drafts with.
 * At `/admin/#/preview`, the admin panel shows nothing and signs nobody in
 * until a script in the page calls `window.goodfellowPreview()` with a draft's
 * content files and an address; it then shows that page as the live site
 * would. Only code already running in the page can call it, so no link and no
 * other site can put content here.
 */
import {
  type ContentSource,
  findSitePage,
  type GoodfellowConfig,
  loadSiteContent,
  type SiteContent,
  todayIn,
} from "@goodfellow-cms/core";
import { createPuckConfigs, PageBody, type PreparedPage, preparePage } from "@goodfellow-cms/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { PreviewOptions } from "./admin-context.js";
import { installPreviewStyles } from "./preview.js";

/** The admin panel's address for the preview page. */
export const PREVIEW_ROUTE = "#/preview";

/** What a tool gives the preview: every content file, as text, by its path in the repository. */
export interface PreviewRequest {
  files: Record<string, string>;
  /** The page's address on the site, such as `/about`. */
  path: string;
}

export type PreviewResult = { ok: true; status: number } | { ok: false; problem: string };

declare global {
  interface Window {
    goodfellowPreview?: (request: PreviewRequest) => Promise<PreviewResult>;
  }
}

/** Whether the admin panel was opened at the preview page. */
export function isPreviewAddress(hash: string): boolean {
  return hash === PREVIEW_ROUTE;
}

function filesSource(files: Record<string, string>): ContentSource {
  return {
    read: async (path) => (Object.hasOwn(files, path) ? files[path] : undefined),
    list: async (dir) =>
      Object.keys(files)
        .filter((path) => path.startsWith(`${dir}/`))
        .sort(),
  };
}

const EMPTY_DOCUMENT =
  '<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body></body></html>';

interface Shown {
  content: SiteContent;
  prepared: PreparedPage;
}

/**
 * Shows a page from content handed to `window.goodfellowPreview()`, full width,
 * in an iframe as tall as the page, so the site's styles and the admin panel's
 * don't mix and a full-page screenshot shows all of it.
 */
export function SitePreview({ config, preview }: { config: GoodfellowConfig; preview: PreviewOptions }) {
  const configs = useMemo(() => createPuckConfigs(config), [config]);
  const [doc, setDoc] = useState<Document | null>(null);
  const [shown, setShown] = useState<Shown>();
  const [height, setHeight] = useState(800);
  const rendered = useRef<() => void>(undefined);

  useEffect(() => {
    window.goodfellowPreview = async ({ files, path }) => {
      let content: SiteContent;
      try {
        content = await loadSiteContent(filesSource(files));
      } catch (error) {
        return { ok: false, problem: (error as Error).message };
      }
      const match = findSitePage(content, todayIn(content.settings.timeZone), config.blocks, path);
      if (!match) return { ok: false, problem: `The site has no page at ${path}.` };
      const prepared = await preparePage(configs, content, match.page);
      await new Promise<void>((done) => {
        rendered.current = done;
        setShown({ content, prepared });
      });
      return { ok: true, status: match.status };
    };
    return () => {
      delete window.goodfellowPreview;
    };
  }, [config.blocks, configs]);

  useEffect(() => {
    if (!doc || !shown) return;
    installPreviewStyles(doc, preview, {
      theme: shown.content.settings.theme,
      customCss: shown.content.customCss,
    });
    // Once React has put the page in, two frames later so it's been laid out too.
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        setHeight(Math.max(doc.documentElement.scrollHeight, 200));
        rendered.current?.();
        rendered.current = undefined;
      }),
    );
  }, [doc, shown, preview]);

  return (
    <>
      <iframe
        title="Preview"
        srcDoc={EMPTY_DOCUMENT}
        onLoad={(event) => setDoc(event.currentTarget.contentDocument)}
        style={{ display: "block", width: "100%", height, border: 0 }}
      />
      {doc &&
        shown &&
        createPortal(
          <PageBody
            site={shown.prepared.site}
            pageConfig={shown.prepared.pageConfig}
            layoutConfig={shown.prepared.layoutConfig}
            page={shown.prepared.data}
            header={shown.prepared.header}
            footer={shown.prepared.footer}
          />,
          doc.body,
        )}
    </>
  );
}
