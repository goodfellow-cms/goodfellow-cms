// Making an admin, someone who owns the site, with Better Auth's own adapter, so the account and its password are
// stored just as signing in reads them: by `npm run new-admin` (lib/db/new-admin.ts) and by the site's own `/setup/`
// page (lib/first-admin.ts). Nothing here reads files, so it runs on Workers too.
/** The person to make an admin. */
export interface NewAdmin {
  email: string;
  name: string;
  password: string;
}

/** The fewest characters an admin's password may have, as everyone's (lib/auth.ts). */
export const MIN_ADMIN_PASSWORD = 12;

/** The most characters an admin's name may have, as anyone's (`MAX_NAME_LENGTH` in lib/auth.ts). */
export const MAX_ADMIN_NAME = 100;

/** What's wrong with the person's details, in words, or nothing. */
export function newAdminProblem({ email, name, password }: NewAdmin): string | undefined {
  if (!/^[^\s@]+@[^\s@]+$/.test(email) || email.length > 254) return "Give the admin's email address first.";
  if (name.trim() === "" || name.trim().length > MAX_ADMIN_NAME) {
    return `Give the admin's name after their email address, in ${MAX_ADMIN_NAME} characters at most.`;
  }
  if (password.length < MIN_ADMIN_PASSWORD) return `Use a password of at least ${MIN_ADMIN_PASSWORD} characters.`;
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
    linkAccount(account: { userId: string; providerId: string; accountId: string; password: string }): Promise<unknown>;
  };
  password: { hash(password: string): Promise<string> };
}

/** Adds the admin through Better Auth's adapter, refusing an email address someone already has. */
export async function createAdmin(context: AdminMaker, person: NewAdmin): Promise<void> {
  const problem = newAdminProblem(person);
  if (problem) throw new Error(problem);
  const email = person.email.toLowerCase();
  if (await context.internalAdapter.findUserByEmail(email)) throw new AdminTaken(`${email} already has an account.`);
  const user = await context.internalAdapter.createUser(
    { email, name: person.name.trim(), emailVerified: true, role: "admin" },
    { method: "admin" },
  );
  await context.internalAdapter.linkAccount({
    userId: user.id,
    providerId: "credential",
    accountId: user.id,
    password: await context.password.hash(person.password),
  });
}
