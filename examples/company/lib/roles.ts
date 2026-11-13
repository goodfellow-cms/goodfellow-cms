// The role of readers' accounts, apart from lib/auth.ts, so the admins' pages in the browser can name it. No imports.

/**
 * The role of an account someone made themselves, to read the site: a reader, who sees members-only pages only while
 * they subscribe (lib/paywall.ts), and can't edit anything. Admins invite editors and admins.
 */
export const MEMBER_ROLE = "member";
