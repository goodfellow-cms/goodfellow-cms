import { auth } from "@/lib/auth";
import { env } from "@/lib/env";
import { billingAddress, customerOf, paymentsProblem, stripeFor } from "@/lib/stripe";

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
      customer: (userId) => customerOf(adapter, userId),
    });
    return new Response(null, { status: 303, headers: { location: address, "cache-control": "no-store" } });
  } catch (error) {
    return paymentsProblem(error, "Opening the customer portal", request);
  }
}
