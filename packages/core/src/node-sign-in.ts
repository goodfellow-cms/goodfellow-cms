/**
 * `goodfellow sign-in` and `goodfellow-next sign-in`: how editors sign in, in
 * `goodfellow.config.tsx`, for sites whose config the admin panel can't
 * publish, such as those whose content is kept in a repository of its own. The
 * admin panel's Security tab does the same.
 */
import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { CONFIG_FILE } from "./plugin-packages.js";
import {
  type ConfigBackendHost,
  configBackendHost,
  signInClientIdProblem,
  signInServiceProblem,
  withBackendOption,
} from "./sign-in-config.js";

export class SignInSetupError extends Error {}

export interface SignInChange {
  host: ConfigBackendHost;
  /** What was set: the sign-in service's address on GitHub, the application's or consumer's id on GitLab and Bitbucket. */
  value?: string;
}

/**
 * Sets the site's sign-in service (GitHub, `signIn`) or OAuth application's
 * id (GitLab and Bitbucket, `clientId`), or takes it out with `undefined`.
 */
export async function setSignIn(root: string, value: string | undefined): Promise<SignInChange> {
  const file = join(resolve(root), CONFIG_FILE);
  const config = await readFile(file, "utf8").catch(() => {
    throw new SignInSetupError(`There's no ${CONFIG_FILE} in ${resolve(root)}.`);
  });
  const host = configBackendHost(config);
  if (!host) throw new SignInSetupError(`${CONFIG_FILE} doesn't say where the site is stored yet (its backend line).`);
  const key = host === "github" ? "signIn" : "clientId";
  let set: string | undefined;
  if (value !== undefined) {
    if (host === "github") {
      const problem = signInServiceProblem(value);
      if (problem)
        throw new SignInSetupError(
          "The sign-in service's address needs to be https://, with nothing after the domain.",
        );
      set = new URL(value.trim()).origin;
    } else {
      set = value.trim();
      if (signInClientIdProblem(set)) {
        throw new SignInSetupError(
          host === "gitlab" ? "That isn't a GitLab application's ID." : "That isn't a Bitbucket consumer's Key.",
        );
      }
    }
  }
  const next = withBackendOption(config, key, set);
  if (next === undefined) {
    throw new SignInSetupError(
      `${CONFIG_FILE}'s backend line is written in a way this can't change. Set ${key} in it by hand.`,
    );
  }
  await writeFile(file, next);
  return { host, ...(set && { value: set }) };
}
