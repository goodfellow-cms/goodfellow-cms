import { GoodfellowAdmin } from "@goodfellow-cms/next/admin";
import { site } from "@/lib/site";

// The admin panel's page never loads the site's config: it's told about the site's blocks here, on the server,
// and the blocks themselves run in the editor's frames, at /admin/editor/. Editors sign in with the site's own
// accounts, and the admin panel reads and publishes through its API, at /api/goodfellow/.
export default function AdminPage() {
  return <GoodfellowAdmin site={site.admin()} server="/api/goodfellow" />;
}
