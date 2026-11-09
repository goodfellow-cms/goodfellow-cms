import { auth } from "@/lib/auth";

// The admin panel's Sign out button comes here: it ends the session, then goes to the home page.
export async function GET(request: Request): Promise<Response> {
  const response = await (await auth()).api.signOut({ headers: request.headers, asResponse: true });
  const headers = new Headers({ location: "/" });
  for (const cookie of response.headers.getSetCookie()) headers.append("set-cookie", cookie);
  return new Response(null, { status: 303, headers });
}
