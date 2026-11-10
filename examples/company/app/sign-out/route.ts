import { auth } from "@/lib/auth";
import { signOutRequest } from "@/lib/sign-out";

// The admin panel's Sign out button and the members page's form come here: it ends the session, then goes to the
// home page, for the site's own pages only (lib/sign-out.ts).
async function handler(request: Request): Promise<Response> {
  return signOutRequest(await auth(), request);
}

export { handler as GET, handler as POST };
