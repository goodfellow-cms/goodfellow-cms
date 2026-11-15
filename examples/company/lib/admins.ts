// Making an admin, someone who owns the site, with Better Auth's own adapter, so the account and its password are
// stored just as signing in reads them: by `npm run new-admin` (lib/db/new-admin.ts) and by the site's own `/setup/`
// page (lib/first-admin.ts). Nothing here reads files, so it runs on Workers too.
import { MAX_NAME_LENGTH, MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from "./account-limits.ts";
import { MEMBER_ROLE } from "./roles.ts";

/** The person to make an admin. */
export interface NewAdmin {
  email: string;
  name: string;
  password: string;
}

/** How long an admin's password and name may be: as everyone's. */
export {
  MAX_NAME_LENGTH as MAX_ADMIN_NAME,
  MAX_PASSWORD_LENGTH as MAX_ADMIN_PASSWORD,
  MIN_PASSWORD_LENGTH as MIN_ADMIN_PASSWORD,
} from "./account-limits.ts";

/**
 * An email address as Better Auth's sign-in takes it: zod's `z.email()`, which it checks addresses with, written out,
 * since the site doesn't depend on zod itself. An address it refuses could be made an admin who can't sign in.
 */
export const SIGN_IN_EMAIL =
  /^(?:[A-Za-z0-9_'+-]+\.)*[A-Za-z0-9_'+-]*[A-Za-z0-9_+-]@(?:[A-Za-z0-9][A-Za-z0-9-]*\.)+[A-Za-z]{2,}$/;

/**
 * What's wrong with the person's details, in words, or nothing: as `npm run new-admin` says it, or, `"self"`, as the
 * site's `/setup/` page says it to someone making themselves the admin.
 */
export function newAdminProblem(
  { email, name, password }: NewAdmin,
  words: "command" | "self" = "command",
): string | undefined {
  const self = words === "self";
  if (!SIGN_IN_EMAIL.test(email) || email.length > 254) {
    return self ? "Give your email address." : "Give the admin's email address first.";
  }
  if (name.trim() === "" || name.trim().length > MAX_NAME_LENGTH) {
    return self
      ? `Give your name, in ${MAX_NAME_LENGTH} characters at most.`
      : `Give the admin's name after their email address, in ${MAX_NAME_LENGTH} characters at most.`;
  }
  if (password.length < MIN_PASSWORD_LENGTH || password.length > MAX_PASSWORD_LENGTH) {
    return self
      ? `Choose a password of at least ${MIN_PASSWORD_LENGTH} characters, and at most ${MAX_PASSWORD_LENGTH}.`
      : password.length < MIN_PASSWORD_LENGTH
        ? `Use a password of at least ${MIN_PASSWORD_LENGTH} characters.`
        : `Use a password of at most ${MAX_PASSWORD_LENGTH} characters.`;
  }
  return undefined;
}

/** An address someone already has an account with. */
export class AdminTaken extends Error {
  override name = "AdminTaken";
}

/**
 * What `createAdmin()` uses of Better Auth's context, whatever plugins made it: written out, since each set of
 * plugins gives its context a type of its own.
 */
export interface AdminMaker {
  internalAdapter: {
    findUserByEmail(email: string): Promise<unknown>;
    createUser(
      user: { email: string; name: string; emailVerified: boolean; role: string },
      context: { method: "admin" },
    ): Promise<{ id: string }>;
    updateUser(userId: string, data: { role: string }): Promise<unknown>;
    linkAccount(account: { userId: string; providerId: string; accountId: string; password: string }): Promise<unknown>;
    deleteUser(userId: string): Promise<unknown>;
  };
  password: { hash(password: string): Promise<string> };
}

/** Adds the admin through Better Auth's adapter, refusing an email address someone already has. */
export async function createAdmin(context: AdminMaker, person: NewAdmin): Promise<void> {
  const problem = newAdminProblem(person);
  if (problem) throw new Error(problem);
  const email = person.email.toLowerCase();
  if (await context.internalAdapter.findUserByEmail(email)) throw new AdminTaken(`${email} already has an account.`);
  // Before anything is written, so a failure leaves no account without a password.
  const password = await context.password.hash(person.password);
  // A reader until it has its password, then an admin: D1 has no transactions, so an account left half made, even
  // where removing it fails too, is never an admin nobody can sign in as, which would count as the site's.
  const user = await context.internalAdapter.createUser(
    { email, name: person.name.trim(), emailVerified: true, role: MEMBER_ROLE },
    { method: "admin" },
  );
  try {
    await context.internalAdapter.linkAccount({
      userId: user.id,
      providerId: "credential",
      accountId: user.id,
      password,
    });
  } catch (error) {
    await context.internalAdapter.deleteUser(user.id).catch(() => undefined);
    throw error;
  }
  await context.internalAdapter.updateUser(user.id, { role: "admin" });
}
