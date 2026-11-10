import type { Config, Metadata } from "@puckeditor/core";
import { Render as PuckRender } from "@puckeditor/core/rsc";
import type { ComponentProps } from "react";
import { createPageBody } from "./page-body-shared.js";
import { SiteProvider, setSite } from "./site-context.server.js";
import type { SiteContextValue } from "./site-types.js";

export type { PageBodyProps, PageContentProps, PageHeaderProps } from "./page-body-shared.js";
export { siteMetadata } from "./site-types.js";

/**
 * Puck's server `Render` (0.23) adds `puck.metadata` to a block's props before
 * looking through them for slots, so it mistakes metadata for slot content when
 * a key matches a slot's name, such as an entry's `content` and a Section's
 * `content` slot. Its browser `Render` doesn't. Keeping the objects in
 * metadata non-enumerable hides them from that search, while blocks can still
 * read them as `puck.metadata.entry` and so on.
 */
export function hiddenFromSlots(metadata: Metadata): Metadata {
  const result: Metadata = {};
  for (const [key, value] of Object.entries(metadata)) {
    Object.defineProperty(result, key, {
      value,
      enumerable: value === null || typeof value !== "object",
      configurable: true,
    });
  }
  return result;
}

/** The config with each block setting its page's site before it renders: see `setSite()`. */
function withSite(config: Config, site: SiteContextValue): Config {
  const components = Object.fromEntries(
    Object.entries(config.components).map(([name, component]) => [
      name,
      {
        ...component,
        render: (props: Parameters<typeof component.render>[0]) => {
          setSite(site);
          return component.render(props);
        },
      },
    ]),
  );
  return { ...config, components } as Config;
}

/** Puck's server `Render`, matching its browser `Render`: that wraps the content in a `<div>`, so the same CSS applies either way. */
function Render({
  config,
  metadata = {},
  site,
  ...props
}: ComponentProps<typeof PuckRender> & { site: SiteContextValue }) {
  return (
    <div>
      <PuckRender {...props} config={withSite(config, site)} metadata={hiddenFromSlots(metadata)} />
    </div>
  );
}

/**
 * Pages rendered as Server Components: `PageBody` is the site header, the page
 * itself and the site footer; `PageHeader`, `PageContent`, and `PageFooter` are its parts.
 */
export const { PageBody, PageHeader, PageContent, PageFooter } = createPageBody({ Render, SiteProvider });
