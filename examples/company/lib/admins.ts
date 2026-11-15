// Making an admin, someone who owns the site, with Better Auth's own adapter, so the account and its password are
// stored just as signing in reads them: by `npm run new-admin` (lib/db/new-admin.ts) and by the site's own `/setup/`
// page (lib/first-admin.ts). Nothing here reads files, so it runs on Workers too.
import { MEMBER_ROLE } from "./roles.ts";

/** The person to make an admin. */
export interface NewAdmin {
  email: string;
  name: string;
  password: string;
}

/** The fewest characters an admin's password may have, as everyone's (lib/auth.ts). */
export const MIN_ADMIN_PASSWORD = 12;

/** The most characters an admin's password may have: Better Auth's own limit when signing in. */
export const MAX_ADMIN_PASSWORD = 128;

/**
 * An email address as Better Auth's sign-in takes it: zod's `z.email()`, which it checks addresses with, written out,
 * since the site doesn't depend on zod itself. An address it refuses could be made an admin who can't sign in.
 */
export const SIGN_IN_EMAIL =
  /^(?:[A-Za-z0-9_'+-]+\.)*[A-Za-z0-9_'+-]*[A-Za-z0-9_+-]@(?:[A-Za-z0-9][A-Za-z0-9-]*\.)+[A-Za-z]{2,}$/;

/** The most characters an admin's name may have, as anyone's (`MAX_NAME_LENGTH` in lib/auth.ts). */
export const MAX_ADMIN_NAME = 100;

/** What's wrong with the person's details, in words, or nothing. */
export function newAdminProblem({ email, name, password }: NewAdmin): string | undefined {
  if (!SIGN_IN_EMAIL.test(email) || email.length > 254) return "Give the admin's email address first.";
  if (name.trim() === "" || name.trim().length > MAX_ADMIN_NAME) {
    return `Give the admin's name after their email address, in ${MAX_ADMIN_NAME} characters at most.`;
  }
  if (password.length < MIN_ADMIN_PASSWORD) return `Use a password of at least ${MIN_ADMIN_PASSWORD} characters.`;
  if (password.length > MAX_ADMIN_PASSWORD) return `Use a password of at most ${MAX_ADMIN_PASSWORD} characters.`;
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
