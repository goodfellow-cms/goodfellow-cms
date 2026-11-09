"use client";

import { adminClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

// Sign-in in the browser, at the site's own address. Pages are the same for everyone, so whatever shows who's
// signed in reads it from here once the page has loaded.
export const authClient = createAuthClient({ plugins: [adminClient()] });
