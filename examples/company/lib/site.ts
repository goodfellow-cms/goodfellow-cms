import { goodfellowPages } from "@goodfellow-cms/next";
import { PAYWALL_BLOCK } from "@/blocks/paywall";
import config from "@/goodfellow.config";

/**
 * The site's pages, shared by the routes that show them: members-only pages as their teasers, ending at their
 * Paywall block, for everyone but subscribers, whom proxy.ts sends to the pages' members' versions.
 */
export const site = goodfellowPages(config, { paywall: PAYWALL_BLOCK });
