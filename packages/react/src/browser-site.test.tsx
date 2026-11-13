import type { Collection } from "@goodfellow-cms/core";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { browserSite } from "./browser-site.js";
import { useSite } from "./site-context.js";
import { SiteProvider } from "./site-context.server.js";
import type { SiteContextValue } from "./site-types.js";

const collection = (id: string, visibility?: "members") =>
  ({
    id,
    settings: { version: 1, name: id, ...(visibility && { visibility }) },
    entries: [
      {
        collection: id,
        slug: "first",
        file: `${id}/first.json`,
        content: { version: 1, fields: { body: `${id} body` } },
      },
    ],
  }) as unknown as Collection;

const news = collection("news");
const reports = collection("reports", "members");
const site = (more: Partial<SiteContextValue> = {}) =>
  ({ settings: {}, menus: {}, path: "/", collections: [news, reports], ...more }) as unknown as SiteContextValue;

describe("the site as the browser has it", () => {
  it("leaves out the collections that are for members only", () => {
    expect(browserSite(site()).collections).toEqual([news]);
  });

  it("leaves out the page's item and collection where they're for members only", () => {
    const shown = browserSite(site({ entry: reports.entries[0], collection: reports }));
    expect(shown.entry).toBeUndefined();
    expect(shown.collection).toBeUndefined();
    expect(JSON.stringify(shown)).not.toContain("reports body");
  });

  it("keeps everyone's items, and the site as it is where nothing is for members", () => {
    const shown = browserSite(site({ entry: news.entries[0], collection: news }));
    expect(shown.entry).toBe(news.entries[0]);
    expect(shown.collection).toBe(news);
    const open = site({ collections: [news] });
    expect(browserSite(open)).toBe(open);
  });

  it("is what the server's SiteProvider gives Client Components", () => {
    function ClientProbe() {
      return <>{JSON.stringify(useSite())}</>;
    }
    const html = renderToString(
      <SiteProvider value={site({ entry: reports.entries[0], collection: reports })}>
        <ClientProbe />
      </SiteProvider>,
    );
    expect(html).toContain("news body");
    expect(html).not.toContain("reports body");
  });
});
