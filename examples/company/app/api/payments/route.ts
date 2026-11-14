import { auth } from "@/lib/auth";
import { problemResponse } from "@/lib/editors";
import { env } from "@/lib/env";
import { paymentsOverview } from "@/lib/payments";
import { site } from "@/lib/site";

// The Payments page's overview, for the site's owners only (lib/payments.ts): its settings for payments, and every Buy
// button on the site as visitors see it, with what Stripe says of its price.
export async function GET(request: Request): Promise<Response> {
  try {
    const overview = await paymentsOverview(await auth(), request, {
      siteEnv: await env(),
      content: await site.loadSite(),
    });
    return Response.json(overview, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return problemResponse(error);
  }
}
