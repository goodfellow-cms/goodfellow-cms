import { goodfellowPages } from "@goodfellow-cms/next";
import config from "@/goodfellow.config";

/** The site's pages, shared by the routes that show them. */
export const site = goodfellowPages(config);
