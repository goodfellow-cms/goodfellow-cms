/**
 * A page of the site shown in a frame, as the live site would show it: for
 * Site Settings' and Version history's previews, an item's preview and the
 * preview page tools take screenshots with.
 */
import { todayIn } from "@goodfellow-cms/core";
import { PageBody, type PreparedPage, preparePage } from "@goodfellow-cms/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { type PreviewStyles, usePreviewStyles } from "../preview.js";
import { findPage } from "../site-code.js";
import type { Channel } from "./channel.js";
import { useFrameCode } from "./frame-site.js";
import type { RenderShow, RenderShown } from "./protocol.js";

/** Styles for before a page is shown, which aren't put in the page. */
const NOTHING_SHOWN: PreviewStyles = { theme: { colors: {}, fonts: {} }, customCss: "" };

interface Shown {
  show: RenderShow;
  prepared: PreparedPage;
}

export function FrameRender({ channel }: { channel: Channel }) {
  const { code, pageConfig, layoutConfig, templateConfig } = useFrameCode();
  const [shown, setShown] = useState<Shown>();
  const rendered = useRef<() => void>(undefined);

  useEffect(
    () =>
      channel.handle("render.show", async (show: RenderShow): Promise<RenderShown> => {
        const { content } = show;
        const today = todayIn(content.settings.timeZone);
        const match = await findPage(code, content, today, show.path);
        if (!match) return { ok: false, problem: `The site has no page at ${show.path}.` };
        const prepared = await preparePage(
          { page: pageConfig, layout: layoutConfig, template: templateConfig },
          content,
          match.page,
        );
        await new Promise<void>((done) => {
          rendered.current = done;
          setShown({ show, prepared });
        });
        return { ok: true, status: match.status, height: document.documentElement.scrollHeight };
      }),
    [channel, code, pageConfig, layoutConfig, templateConfig],
  );

  const styles = useMemo(
    () =>
      shown && {
        theme: shown.show.content.settings.theme,
        customCss: shown.show.content.customCss,
        ...(shown.show.scheme && { scheme: shown.show.scheme }),
      },
    [shown],
  );
  usePreviewStyles(styles ? document : undefined, styles ?? NOTHING_SHOWN);

  useEffect(() => {
    if (!shown) return;
    // Once React has put the page in, two frames later so it's been laid out too.
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        rendered.current?.();
        rendered.current = undefined;
      }),
    );
  }, [shown]);

  // Tells the admin panel's page how tall the page is, for previews as tall as their page.
  useEffect(() => {
    let last = 0;
    const observer = new ResizeObserver(() => {
      const height = document.documentElement.scrollHeight;
      if (height === last) return;
      last = height;
      channel.emit("render.height", height);
    });
    observer.observe(document.body);
    return () => observer.disconnect();
  }, [channel]);

  if (!shown) return null;
  const { prepared } = shown;
  return createPortal(
    <PageBody
      site={prepared.site}
      pageConfig={prepared.pageConfig}
      layoutConfig={prepared.layoutConfig}
      page={prepared.data}
      header={prepared.header}
      footer={prepared.footer}
    />,
    document.body,
  );
}
