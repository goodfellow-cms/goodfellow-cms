import { site } from "@/lib/site";
import "@/app/site.css";

// The members' version of every page: members-only pages in full, and every other page as it is. proxy.ts sends
// subscribers' requests for pages here, and answers "Page not found" to a request for this address itself, since only
// its cookie says who may see these. Each renders from the content repository the first time a subscriber asks for
// it, and is kept as every page is (see app/(site)/[[...path]]/page.tsx), so subscribers' visits are served from the
// cache too. None is built ahead, since proxy.ts can't tell which pages are for members.
export const dynamic = "force-static";
// Written out, since Next.js reads it without running the module: the same as the pages' own.
export const revalidate = 3600;
export const generateMetadata = site.generateMetadata;
export default site.MembersPage;
