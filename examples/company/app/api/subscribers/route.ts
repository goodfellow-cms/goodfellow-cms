import { auth } from "@/lib/auth";
import { problemResponse } from "@/lib/editors";
import { giftFrom, giveSubscription, listSubscribers } from "@/lib/subscribers";

// The subscribers page's list of readers, and giving someone a subscription by hand, for the site's admins only
// (lib/subscribers.ts).
export async function GET(request: Request): Promise<Response> {
  try {
    return Response.json(
      { subscribers: await listSubscribers(await auth(), request) },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    return problemResponse(error);
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    const gift = giftFrom(await request.json().catch(() => undefined));
    await giveSubscription(await auth(), request, gift);
    return new Response(null, { status: 204 });
  } catch (error) {
    return problemResponse(error);
  }
}
