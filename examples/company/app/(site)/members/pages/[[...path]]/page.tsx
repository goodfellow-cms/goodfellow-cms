import { site } from "@/lib/site";
import "@/app/site.css";

// The members' version of every page: members-only pages in full, and every other page as it is. proxy.ts sends
// subscribers' requests for pages here, and answers "Page not found" to a request for this address itself, since only
// its cookie says who may see these. Every page is built here too, since proxy.ts can't tell which pages are for
// members, and the Worker renders no page that wasn't built: it has the site's content only as the build left it.
export const generateStaticParams = site.generateStaticParams;
export const generateMetadata = site.generateMetadata;
export default site.MembersPage;
