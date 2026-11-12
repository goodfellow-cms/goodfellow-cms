"use client";

import { twoFactorClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

// Sign-in in the browser, at the site's own address. Pages are the same for everyone, so whatever shows who's
// signed in reads it from here once the page has loaded.
export const authClient = createAuthClient({ plugins: [twoFactorClient()] });

/** What a form says when Better Auth's limits refuse a try (429). */
export const TOO_MANY = "That's too many tries for now. Wait a few minutes, then try again.";
