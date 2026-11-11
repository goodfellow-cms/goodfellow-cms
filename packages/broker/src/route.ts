/**
 * What a sign-in brings back in the address: the sign-in worker's grant and
 * problem, and OAuth's codes and tokens, such as Bitbucket's `access_token`.
 */
const SIGN_IN_PARAMS = [
  "goodfellow_sign_in",
  "goodfellow_sign_in_error",
  "access_token",
  "code",
  "state",
  "error",
  "error_description",
];

/**
 * The admin panel's screen an address names, such as `#/settings/editors`,
 * without anything a sign-in brought back, which stays with the broker and
 * never reaches the framed page's address; or nothing, where it names none.
 */
export function adminRoute(hash: string): string | undefined {
  if (!hash.startsWith("#/")) return undefined;
  const at = hash.indexOf("?");
  if (at === -1) return hash;
  const params = new URLSearchParams(hash.slice(at + 1));
  for (const name of SIGN_IN_PARAMS) params.delete(name);
  const rest = params.toString();
  return rest ? `${hash.slice(0, at)}?${rest}` : hash.slice(0, at);
}
