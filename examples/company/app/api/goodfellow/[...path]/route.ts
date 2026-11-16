import { goodfellowApi } from "@goodfellow-cms/next/server";
import { revalidatePath } from "next/cache";
import config from "@/goodfellow.config";
import { authorize } from "@/lib/auth";
import { gitToken } from "@/lib/git-token";

// The admin panel's API: it reads and publishes through the server, which reaches the content repository with the
// site's publishing app or GOODFELLOW_GIT_TOKEN (lib/git-token.ts), naming each editor as the author of what they publish.
export const { GET, POST } = goodfellowApi({
  config,
  authorize,
  signIn: "/sign-in/?next=/admin/",
  signOut: "/sign-out/",
  // Every page renders again from the new revision the next time it's visited: a publish can change the header,
  // footer, menus, or settings every page shows, and collection lists show items from anywhere.
  onPublish() {
    revalidatePath("/", "layout");
  },
  token: gitToken(config.backend),
});
