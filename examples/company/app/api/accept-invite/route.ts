import { auth } from "@/lib/auth";
import { acceptInvitation, problemResponse } from "@/lib/editors";

// Choosing a password from an invitation's link (lib/editors.ts).
export async function POST(request: Request): Promise<Response> {
  try {
    await acceptInvitation(await auth(), request, await request.json().catch(() => undefined));
    return new Response(null, { status: 204 });
  } catch (error) {
    return problemResponse(error);
  }
}
