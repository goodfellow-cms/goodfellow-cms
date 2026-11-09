import { goodfellowApi } from "@goodfellow-cms/next/server";
import config from "@/goodfellow.config";
import { authorize } from "@/lib/auth";
import { env } from "@/lib/env";

// The admin panel's API: it reads and publishes through the server, which reaches the content repository with
// GOODFELLOW_GIT_TOKEN, naming each editor as the author of what they publish.
export const { GET, POST } = goodfellowApi({
  config,
  authorize,
  signIn: "/sign-in/?next=/admin/",
  signOut: "/sign-out/",
  async token() {
    const token = (await env()).GOODFELLOW_GIT_TOKEN;
    if (!token) throw new Error("Set GOODFELLOW_GIT_TOKEN to a token that can publish to the content repository.");
    return token;
  },
});
