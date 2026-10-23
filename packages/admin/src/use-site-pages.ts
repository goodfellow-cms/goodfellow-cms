import { allPages, type Page, type SiteContent, todayIn } from "@goodfellow-cms/core";
import { useEffect, useState } from "react";
import { useAdmin } from "./admin-context.js";

/**
 * Every page a build writes for the site, as `sitePages()` gives them, from
 * the frame that runs the site's code: the site's pages and items' pages
 * until it answers, or if it can't.
 */
export function useSitePages(content: SiteContent): Page[] {
  const { code } = useAdmin();
  const [pages, setPages] = useState<{ content: SiteContent; pages: Page[] }>();
  useEffect(() => {
    let current = true;
    code.sitePages(content, todayIn(content.settings.timeZone)).then(
      (found) => current && setPages({ content, pages: found }),
      () => current && setPages({ content, pages: allPages(content) }),
    );
    return () => {
      current = false;
    };
  }, [code, content]);
  return pages?.content === content ? pages.pages : allPages(content);
}
