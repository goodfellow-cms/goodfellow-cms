import { auth } from "@/lib/auth";
import { inviteAgain, problemResponse } from "@/lib/editors";
import { env } from "@/lib/env";

// A new invitation for someone who hasn't joined yet, for the site's admins only (lib/editors.ts).
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const invited = await inviteAgain(await auth(), await env(), request, (await params).id);
    return Response.json(invited, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return problemResponse(error);
  }
}
