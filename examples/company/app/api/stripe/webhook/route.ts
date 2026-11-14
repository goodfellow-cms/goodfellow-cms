import { auth } from "@/lib/auth";
import { env } from "@/lib/env";
import { webhookResponse } from "@/lib/stripe";

// Stripe's events, which say a payment arrived or a subscription changed (lib/stripe.ts). The address to give Stripe
// ends in a slash, /api/stripe/webhook/, since the site's addresses do, and Stripe doesn't follow redirects.
export async function POST(request: Request): Promise<Response> {
  const siteEnv = await env();
  try {
    const siteAuth = await auth();
    // Stripe's client is made once the webhook knows the site takes payments, so a missing key is a 503, not a failure.
    return await webhookResponse(request, { siteEnv, adapter: (await siteAuth.$context).adapter });
  } catch (error) {
    // Stripe tries again, for up to three days.
    console.error(`A Stripe event failed: ${error instanceof Error ? error.name : "error"}.`);
    return new Response("Try again.", { status: 500 });
  }
}
