/**
 * The page tools such as the Claude connector take screenshots of drafts with.
 * At `/admin/#/preview`, the admin panel shows nothing and signs nobody in
 * until a script in the page calls `window.goodfellowPreview()` with a draft's
 * content files and an address; it then shows that page as the live site
 * would. Only code already running in the page can call it, so no link and no
 * other site can put content here.
 */
import { type ContentSource, loadSiteContent, type SiteContent } from "@goodfellow-cms/core";
import { useEffect, useMemo, useState } from "react";
import type { PreviewOptions } from "./admin-context.js";
import { type FrameServices, FrameServicesProvider, type FrameSource, useFrame } from "./frame/host.js";
import { createMediaPreviews } from "./media-previews.js";
import { useStringTable } from "./strings.js";
import { useThemeChoice } from "./theme.js";

/** The admin panel's address for the preview page. */
export const PREVIEW_ROUTE = "#/preview";

/** What a tool gives the preview: every content file, as text, by its path in the repository. */
export interface PreviewRequest {
  files: Record<string, string>;
  /** The page's address on the site, such as `/about`. */
  path: string;
  /** Shows a site with dark mode dark. Light otherwise. */
  dark?: boolean;
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

/**
 * Shows a page from content handed to `window.goodfellowPreview()`, full
 * width, in a frame as tall as the page, which runs the site's code sandboxed
 * as the editor does, so a full-page screenshot shows all of it.
 */
export function SitePreview({
  frames,
  preview,
  siteUrl,
}: {
  frames: FrameSource;
  preview: PreviewOptions;
  siteUrl: string;
}) {
  const strings = useStringTable();
  const theme = useThemeChoice();
  const [empty, setEmpty] = useState<SiteContent>();
  useEffect(() => {
    void loadSiteContent(filesSource({})).then(setEmpty);
  }, []);
  const services = useMemo<FrameServices | undefined>(
    () =>
      empty && {
        source: frames,
        init: { content: empty, media: [], schedule: {}, siteUrl, preview, strings, theme, hostName: "" },
        siteCss: async () => [],
        // Media comes from the live site; there's no repository to read the rest from.
        mediaPreviews: createMediaPreviews({ readBytes: async () => undefined }, siteUrl),
        chooseMedia: async () => null,
        navigate: () => {},
      },
    [empty, frames, siteUrl, preview, strings, theme],
  );
  return services ? (
    <FrameServicesProvider value={services}>
      <PreviewPage />
    </FrameServicesProvider>
  ) : null;
}

function PreviewPage() {
  const { client, frameProps } = useFrame({ mode: "render" });
  const [height, setHeight] = useState(800);

  useEffect(() => {
    if (!client) return;
    const stop = client.on("render.height", (next) => setHeight(Math.max(next, 200)));
    window.goodfellowPreview = async ({ files, path, dark }) => {
      let content: SiteContent;
      try {
        content = await loadSiteContent(filesSource(files));
      } catch (error) {
        return { ok: false, problem: (error as Error).message };
      }
      const shown = await client.call("render.show", { content, path, scheme: dark === true ? "dark" : "light" });
      if (!shown.ok) return shown;
      setHeight(Math.max(shown.height, 200));
      // Once the frame is as tall as the page, two frames later so it's been laid out too.
      await new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done())));
      return { ok: true, status: shown.status };
    };
    return () => {
      stop();
      delete window.goodfellowPreview;
    };
  }, [client]);

  return <iframe title="Preview" {...frameProps} style={{ display: "block", width: "100%", height, border: 0 }} />;
}
