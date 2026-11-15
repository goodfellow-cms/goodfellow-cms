import { auth } from "@/lib/auth";
import { env } from "@/lib/env";
import { setUpFirstAdmin, setupProblem } from "@/lib/first-admin";

// Making the site's first admin with its setup code (lib/first-admin.ts).
export async function POST(request: Request): Promise<Response> {
  try {
    await setUpFirstAdmin(await auth(), await env(), request);
    return new Response(null, { status: 204, headers: { "cache-control": "no-store" } });
  } catch (error) {
    return setupProblem(error);
  }
}
