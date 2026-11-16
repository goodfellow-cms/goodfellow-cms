// How long passwords and names may be, for every account: in a module of its own, with no imports, so sign-in, the
// first admin's setup, `npm run new-admin`, and the browser's forms all read the same numbers.

/** The fewest characters a password may have. */
export const MIN_PASSWORD_LENGTH = 12;

/** The most characters a password may have: Better Auth's own limit when signing in. */
export const MAX_PASSWORD_LENGTH = 128;

/** The longest name an account may have, as invitations and sign-ups take. */
export const MAX_NAME_LENGTH = 100;
