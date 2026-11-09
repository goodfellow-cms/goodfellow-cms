import { auth } from "@/lib/auth";

// Better Auth's own routes: signing in and out, sessions, and the admin plugin's user management.
async function handler(request: Request): Promise<Response> {
  return (await auth()).handler(request);
}

export { handler as GET, handler as POST };
