import { auth } from "@/lib/auth";
import { env } from "@/lib/env";
import { forgetReader } from "@/lib/paywall";
import { sitePath } from "@/lib/site-path";
import { returnFromCheckout, stripeFor } from "@/lib/stripe";

// Where Stripe Checkout sends people back to once they've paid: what they bought is written straight away, and the
// paywall's cookie is forgotten, so the page they bought it on shows it now (lib/stripe.ts).
export async function GET(request: Request): Promise<Response> {
  const siteAuth = await auth();
  const siteEnv = await env();
  let next = "/";
  try {
    next = await returnFromCheckout(request, {
      siteAuth,
      stripe: stripeFor(siteEnv),
      adapter: (await siteAuth.$context).adapter,
    });
  } catch (error) {
    // The webhook writes it anyway: going back to the page is never held up by this.
    console.error(`Writing a payment on the way back failed: ${error instanceof Error ? error.name : "error"}.`);
    next = sitePath(new URL(request.url).searchParams.get("next"));
  }
  const headers = new Headers({ location: next, "cache-control": "no-store" });
  headers.append("set-cookie", forgetReader(request));
  return new Response(null, { status: 303, headers });
}
