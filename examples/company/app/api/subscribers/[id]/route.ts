import { auth } from "@/lib/auth";
import { problemResponse } from "@/lib/editors";
import { removeSubscriber } from "@/lib/subscribers";

// Removing a reader's account, for the site's admins only (lib/subscribers.ts).
type Context = { params: Promise<{ id: string }> };

export async function DELETE(request: Request, { params }: Context): Promise<Response> {
  try {
    await removeSubscriber(await auth(), request, (await params).id);
    return new Response(null, { status: 204 });
  } catch (error) {
    return problemResponse(error);
  }
}
