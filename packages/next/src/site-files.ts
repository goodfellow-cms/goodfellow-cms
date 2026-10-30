import type { SiteFile } from "@goodfellow-cms/core/node";

/** The release whose Next.js sites have the editor's sandboxed frames at `app/admin/editor/`. */
const FRAMES_RELEASE = "0.5.0";

/** The release whose Next.js sites tell Vercel not to build drafts' and plugins' tasks' branches. */
const VERCEL_BRANCHES_RELEASE = "0.9.0";

/** `app/admin/page.tsx` as every release before the frames wrote it, loading the site's config itself. */
const CLIENT_ADMIN_PAGE = `"use client";

import { GoodfellowAdmin } from "@goodfellow-cms/next/admin";
import config from "@/goodfellow.config";

export default function AdminPage() {
  return <GoodfellowAdmin config={config} />;
}
`;

export const ADMIN_PAGE = `import { GoodfellowAdmin } from "@goodfellow-cms/next/admin";
import { site } from "@/lib/site";

// The admin panel's page never loads the site's config: it's told about the site's blocks here, on the server,
// and the blocks themselves run in the editor's frames, at /admin/editor/.
export default function AdminPage() {
  return <GoodfellowAdmin site={site.admin()} />;
}
`;

export const EDITOR_PAGE = `"use client";

import { GoodfellowEditor } from "@goodfellow-cms/next/editor";
import config from "@/goodfellow.config";

// The editor's frames: Puck and the site's blocks, sandboxed away from the admin panel's page.
export default function EditorPage() {
  return <GoodfellowEditor config={config} />;
}
`;

/**
 * The Next.js starter's files that `goodfellow-next update` keeps up to date
 * where nobody has changed them, as the starter now has them. A test checks
 * they match `templates/next`.
 */
/**
 * Vercel builds a preview of every branch, with the project's settings and
 * secrets, unless told not to: drafts are kept on branches named
 * `goodfellow-draft-…`, with code owners and editors submitted for review, and
 * plugins' tasks answer on `goodfellow-task-…`, neither of which visitors see.
 */
export const VERCEL_JSON = `{
  "git": {
    "deploymentEnabled": {
      "goodfellow-draft-*": false,
      "goodfellow-task-*": false
    }
  }
}
`;

export const NEXT_SITE_FILES: readonly SiteFile[] = [
  { path: "app/admin/page.tsx", since: FRAMES_RELEASE, content: ADMIN_PAGE, earlier: [CLIENT_ADMIN_PAGE] },
  { path: "app/admin/editor/page.tsx", since: FRAMES_RELEASE, content: EDITOR_PAGE, earlier: [] },
  { path: "vercel.json", since: VERCEL_BRANCHES_RELEASE, content: VERCEL_JSON, earlier: [] },
];
