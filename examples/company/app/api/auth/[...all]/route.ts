import { auth, authRoute } from "@/lib/auth";

// Better Auth's own routes: signing in and out, two-factor sign-in, sessions, and password resets, but not the admin
// plugin's (`authRoute()`).
async function handler(request: Request): Promise<Response> {
  return authRoute(await auth(), request);
}

export { handler as GET, handler as POST };
