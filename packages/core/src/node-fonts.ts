import type { ReadStylesheet } from "./fonts.js";

/** How long a build waits for a stylesheet before going on without it. */
const TIMEOUT_MS = 5000;

/** Reads a stylesheet from the web, for `fontPreloads()`. */
export const readStylesheet: ReadStylesheet = async (url, userAgent) => {
  try {
    const response = await fetch(url, {
      headers: { "user-agent": userAgent },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    return response.ok ? await response.text() : undefined;
  } catch {
    return undefined;
  }
};
