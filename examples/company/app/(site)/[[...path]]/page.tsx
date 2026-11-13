import { site } from "@/lib/site";
import "@/app/site.css";

// Builds every page in content/. Other addresses show "Page not found": a static host has no file for
// them, and in `next dev` the page isn't found. (`dynamicParams` stays on, so `next dev` shows new pages at once.)
export const generateStaticParams = site.generateStaticParams;
// The same for everyone, so each page is kept once it has rendered (vite.config.ts), until a publish says it changed.
export const dynamic = "force-static";
// And for an hour at most, so what no publish here marks shows within the hour: a page's scheduled time coming, what it
// shows by today's date, and changes that reach the content repository another way, such as from Claude or a review.
// (Next.js reads this without running the module, so it's written out, as in app/sitemap.ts.)
export const revalidate = 3600;
export const generateMetadata = site.generateMetadata;
export default site.Page;
