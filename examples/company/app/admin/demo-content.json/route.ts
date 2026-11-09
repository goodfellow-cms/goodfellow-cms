import { site } from "@/lib/site";

// The copy of the site's content a demo's admin panel starts from, when the config sets `demo`.
export const dynamic = "force-static";
export const GET = site.demoContent;
