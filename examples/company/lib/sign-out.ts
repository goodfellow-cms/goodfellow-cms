// Signing out, which only the site's own pages can ask for: a link or form on another site could otherwise sign
// people out without their asking.
import type { SiteAuth } from "./auth.ts";

/** Whether the site's own pages sent a request, as the browser says: `Sec-Fetch-Site`, else `Origin`. */
export function fromThisSite(request: Request): boolean {
  const site = request.headers.get("sec-fetch-site");
  if (site) return site === "same-origin";
  return request.headers.get("origin") === new URL(request.url).origin;
}

/** Ends the session and goes to the home page, passing on the cookies Better Auth clears. */
async function signOut(siteAuth: SiteAuth, request: Request): Promise<Response> {
  const response = await siteAuth.api.signOut({ headers: request.headers, asResponse: true });
  const headers = new Headers({ location: "/" });
  for (const cookie of response.headers.getSetCookie()) headers.append("set-cookie", cookie);
  return new Response(null, { status: 303, headers });
}

/** A page that asks before signing out, for a request from anywhere else, such as an address typed in. */
function confirmPage(): Response {
  return new Response(
    `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Sign out</title></head>
<body>
<main>
<h1>Sign out?</h1>
<form method="post" action="/sign-out/"><button type="submit">Sign out</button></form>
<p><a href="/">Go to the home page</a></p>
</main>
</body>
</html>
`,
    {
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
        "content-security-policy": "default-src 'none'; form-action 'self'; frame-ancestors 'none'",
      },
    },
  );
}

/**
 * The admin panel's Sign out button goes here with `GET`, from the site's own address, and the members page's
 * form posts here. Requests from anywhere else are asked to confirm (`GET`) or refused (`POST`).
 */
export async function signOutRequest(siteAuth: SiteAuth, request: Request): Promise<Response> {
  if (fromThisSite(request)) return signOut(siteAuth, request);
  if (request.method === "POST") return new Response("Sign out from the site's own pages.", { status: 403 });
  return confirmPage();
}
