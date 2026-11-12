import { type NextRequest, NextResponse } from "next/server";
import { auth, sessionSecret, signedInWith } from "@/lib/auth";
import { env } from "@/lib/env";
import {
  isMembersVersion,
  isPageRequest,
  membersVersionUrl,
  readerFor,
  routedPath,
} from "@/lib/paywall";

/** Pages only people who are signed in see; anyone else is sent to sign in first. */
const SIGNED_IN_ONLY = /^\/(?:members|admin\/editors|account)(?:\/|$)/;

// Runs before any page, so pages themselves stay the same for everyone they're for and are served from the cache: it
// only chooses where a request goes.
//
// - Subscribers' requests for pages go to the pages' members' versions (lib/paywall.ts), which show members-only
//   pages in full; everyone else's get the pages as they are, where those are teasers. A request for a members'
//   version itself is "Page not found", whoever asks, since only the cookie says who may see one.
// - Pages for people who are signed in send everyone else to sign in first. The session is read from the database,
//   not only its cookie seen, so a made-up, ended, or banned one gets no further.
export async function proxy(request: NextRequest): Promise<NextResponse> {
  const path = routedPath(request.nextUrl.pathname);
  if (path === undefined || isMembersVersion(path)) {
    return NextResponse.rewrite(new URL("/404/", request.url));
  }

  if (SIGNED_IN_ONLY.test(path)) {
    const { signedIn, cookies } = await signedInWith(await auth(), request);
    let response = NextResponse.next();
    if (!signedIn) {
      const signIn = new URL("/sign-in/", request.url);
      signIn.searchParams.set("next", request.nextUrl.pathname);
      response = NextResponse.redirect(signIn);
    }
    for (const cookie of cookies) response.headers.append("set-cookie", cookie);
    return response;
  }

  if (!isPageRequest(request.method, path)) return NextResponse.next();
  const { reader, cookies } = await readerFor(request, async () => ({
    siteAuth: await auth(),
    secret: sessionSecret(await env()),
  }));
  const response =
    reader === "members" ? NextResponse.rewrite(membersVersionUrl(request.nextUrl)) : NextResponse.next();
  // The members' version is only theirs: no cache between the site and the browser may keep it for anyone else.
  if (reader === "members") response.headers.set("cache-control", "private, no-store");
  for (const cookie of cookies) response.headers.append("set-cookie", cookie);
  return response;
}

// Every request but Next.js's own built files, so every spelling of a members' version's address is checked.
export const config = { matcher: ["/((?!_next/static/|_next/image).*)"] };
