import { type NextRequest, NextResponse } from "next/server";
import { auth, signedInWith } from "@/lib/auth";

// Runs before any page, so pages themselves stay the same for everyone and are served from the cache: it only
// chooses where a request goes. Pages for people who are signed in send everyone else to sign in first. The session
// is read from the database, not only its cookie seen, so a made-up, ended, or banned one gets no further.
export async function proxy(request: NextRequest): Promise<NextResponse> {
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

export const config = { matcher: ["/members/:path*", "/admin/editors/:path*"] };
