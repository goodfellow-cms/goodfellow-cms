import { auth } from "@/lib/auth";
import { subscriptionsOf } from "@/lib/entitlements";
import { env } from "@/lib/env";
import { billingAddress, PaymentsError, stripeFor } from "@/lib/stripe";

// Where the account page's "Manage your subscription" goes: Stripe's customer portal (lib/stripe.ts).
export async function POST(request: Request): Promise<Response> {
  try {
    const siteAuth = await auth();
    const siteEnv = await env();
    const { adapter } = await siteAuth.$context;
    const address = await billingAddress(request, {
      siteAuth,
      siteEnv,
      stripe: stripeFor(siteEnv),
      subscriptions: (userId) => subscriptionsOf(adapter, userId),
    });
    return new Response(null, { status: 303, headers: { location: address, "cache-control": "no-store" } });
  } catch (error) {
    const known = error instanceof PaymentsError;
    return new Response(known ? error.message : "Something went wrong. Try again in a moment.", {
      status: known ? error.status : 500,
      headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
    });
  }
}
