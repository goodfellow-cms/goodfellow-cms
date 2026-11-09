import { getSessionCookie } from "better-auth/cookies";
import { type NextRequest, NextResponse } from "next/server";

// Runs before any page, so pages themselves stay the same for everyone and are served from the cache: it only
// chooses where a request goes. Pages for people who are signed in send everyone else to sign in first.
export function proxy(request: NextRequest): NextResponse {
  if (getSessionCookie(request)) return NextResponse.next();
  const signIn = new URL("/sign-in/", request.url);
  signIn.searchParams.set("next", request.nextUrl.pathname);
  return NextResponse.redirect(signIn);
}

export const config = { matcher: ["/members/:path*"] };
