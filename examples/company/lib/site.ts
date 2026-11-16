import { type ContentSource, repositorySource } from "@goodfellow-cms/core";
import { goodfellowPages } from "@goodfellow-cms/next";
import { PHASE_PRODUCTION_BUILD } from "next/constants";
import { PAYWALL_BLOCK } from "@/blocks/paywall";
import config from "@/goodfellow.config";
import { buttonOn } from "@/lib/buttons";
import { gitToken } from "@/lib/git-token";
import type { Reader } from "@/lib/paywall";
import type { Button, ButtonPlace } from "@/lib/stripe";

let live: (() => Promise<ContentSource>) | undefined;
const token = gitToken(config.backend);

/**
 * The content repository as it is now, read with the token the admin panel's API publishes with (lib/git-token.ts), so a publish shows
 * once its pages render again, without a rebuild. In `next dev`, the files on this computer, as the admin panel's
 * local backend writes them. While the site is built, the files it's built from. Without the token, a page fails rather
 * than show the content the build had, which the site would keep as though it were current while publishes never
 * showed.
 */
async function source(): Promise<ContentSource | undefined> {
  // `next dev`, and `next build`, which renders pages from the files it builds, as they are then.
  if (process.env.NODE_ENV === "development" || process.env.NEXT_PHASE === PHASE_PRODUCTION_BUILD) return undefined;
  // Asked for here, so a site without one says so rather than fail on its first read.
  await token();
  const backend = config.backend;
  if (!backend?.server) throw new Error("The site's backend can't be reached from its server.");
  live ??= repositorySource(backend.server({ token }));
  return live();
}

/**
 * The site's pages, shared by the routes that show them: members-only pages as their teasers, ending at their
 * Paywall block, for everyone but subscribers, whom proxy.ts sends to the pages' members' versions.
 */
export const site = goodfellowPages(config, { source, paywall: PAYWALL_BLOCK });

/**
 * The Buy button at `place`, as visitors see the site now: read from the site as its pages render it
 * (`site.loadSite()`), from the content repository, once a request, with what pages read, or, in `next dev` and while
 * the site is built, the files pages render from.
 */
export async function findButton(place: ButtonPlace, reader: Reader): Promise<Button | undefined> {
  return buttonOn(await site.loadSite(), place, reader);
}
