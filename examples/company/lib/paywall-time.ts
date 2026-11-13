// How long the paywall's answer is kept, apart from lib/paywall.ts, so the admins' pages can say it. No imports.

/**
 * How long the cookie's answer is kept, in seconds, before the database is asked again: how long a subscription that
 * ends early (cancelled, or refunded) still shows members' pages, and how long someone who has just subscribed waits
 * on a page they were already reading, unless what took the payment clears the cookie.
 */
export const PAYWALL_SECONDS = 10 * 60;
