import { auth } from "@/lib/auth";
import { env } from "@/lib/env";
import { findButton } from "@/lib/site";
import { accountCustomer, checkoutAddress, PaymentsError, stripeFor } from "@/lib/stripe";

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
      customer: (user) => accountCustomer(adapter, stripe, user),
    });
    return new Response(null, { status: 303, headers: { location: address, "cache-control": "no-store" } });
  } catch (error) {
    return problem(error);
  }
}

/** A problem as plain words, since a form posted here: its own for a known one, and nothing about anything else. */
function problem(error: unknown): Response {
  const known = error instanceof PaymentsError;
  if (!known) console.error(`Checkout failed: ${error instanceof Error ? error.name : "error"}.`);
  return new Response(known ? error.message : "Something went wrong. Try again in a moment.", {
    status: known ? error.status : 500,
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
  });
}
