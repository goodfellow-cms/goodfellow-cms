import { site } from "@/lib/site";

export const dynamic = "force-static";
// An hour at most, as pages are (app/(site)/[[...path]]/page.tsx), since schedules change which pages it lists.
export const revalidate = 3600;
export default site.sitemap;
