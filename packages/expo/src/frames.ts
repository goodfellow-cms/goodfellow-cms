/** What a frame of another site's page does with a page it's asked to go to: no React Native, so it's tested in Node. */
export type FrameRequest = "stay" | "open" | "refuse";

function hostOf(url: string): string | undefined {
  try {
    return new URL(url).host;
  } catch {
    return undefined;
  }
}

/**
 * A frame stays on the site it shows: a page of that site, or one a frame
 * inside it goes to, loads in it; another web page opens in the phone's
 * browser; and anything else is refused, since another site's page mustn't
 * call or write to anyone or open other apps (`tel:`, `intent:`). Only iOS
 * says which frame is going somewhere (`isTopFrame`); Android asks only
 * about the frame itself, and leaves it undefined.
 */
export function frameRequest(frameUri: string, request: { url: string; isTopFrame?: boolean }): FrameRequest {
  if (request.isTopFrame === false) return "stay";
  const host = hostOf(frameUri);
  if (host !== undefined && hostOf(request.url) === host && /^https:/i.test(request.url)) return "stay";
  return /^https?:/i.test(request.url) ? "open" : "refuse";
}
