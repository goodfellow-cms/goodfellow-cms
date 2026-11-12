import { auth } from "@/lib/auth";
import { invitationFrom, inviteEditor, listEditors, problemResponse } from "@/lib/editors";
import { env } from "@/lib/env";

// The editors page's list of people, and inviting someone, for the site's admins only (lib/editors.ts).
export async function GET(request: Request): Promise<Response> {
  try {
    return Response.json(
      { editors: await listEditors(await auth(), request) },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    return problemResponse(error);
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    const invitation = invitationFrom(await request.json().catch(() => undefined));
    const invited = await inviteEditor(await auth(), await env(), request, invitation);
    return Response.json(invited, { status: 201, headers: { "cache-control": "no-store" } });
  } catch (error) {
    return problemResponse(error);
  }
}
