import { auth } from "@/lib/auth";
import { problemResponse, removeEditor, setRole } from "@/lib/editors";

// Changing what someone may do, and removing them, for the site's admins only (lib/editors.ts).
type Context = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Context): Promise<Response> {
  try {
    const { role } = ((await request.json().catch(() => undefined)) ?? {}) as { role?: unknown };
    await setRole(await auth(), request, (await params).id, role);
    return new Response(null, { status: 204 });
  } catch (error) {
    return problemResponse(error);
  }
}

export async function DELETE(request: Request, { params }: Context): Promise<Response> {
  try {
    await removeEditor(await auth(), request, (await params).id);
    return new Response(null, { status: 204 });
  } catch (error) {
    return problemResponse(error);
  }
}
