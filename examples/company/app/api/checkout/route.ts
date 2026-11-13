import { auth } from "@/lib/auth";
import { env } from "@/lib/env";
import { findButton } from "@/lib/site";
import { accountCustomer, checkoutAddress, paymentsProblem, stripeFor } from "@/lib/stripe";

// Where a Buy button's form goes (blocks/buy-button.tsx): on to Stripe Checkout, or to sign in first (lib/stripe.ts).
export async function POST(request: Request): Promise<Response> {
  try {
    const siteEnv = await env();
    const siteAuth = await auth();
    const { adapter } = await siteAuth.$context;
    const stripe = stripeFor(siteEnv);
    const address = await checkoutAddress(request, {
      siteAuth,
      siteEnv,
      stripe,
      findButton,
      customer: (user, stale) => accountCustomer(adapter, stripe, user, stale),
    });
    return new Response(null, { status: 303, headers: { location: address, "cache-control": "no-store" } });
  } catch (error) {
    return paymentsProblem(error, "Checkout");
  }
}
