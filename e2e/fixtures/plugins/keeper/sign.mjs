import { createHmac } from "node:crypto";

/** Keeper's `sign` task: a signature for each request, made with the secret only the site's CI (here, the dev server) has. */
export default function sign(input, { secrets }) {
  if (!secrets.KEEPER_KEY) throw new Error("The site has no KEEPER_KEY.");
  return input.requests.map(({ method, address }) => {
    if (address.includes("refused")) throw new Error(`Keeper won't keep ${address}.`);
    const key = address.slice("/media/".length);
    return {
      method,
      address,
      signature: createHmac("sha256", secrets.KEEPER_KEY).update(`${method} ${key}`).digest("hex"),
    };
  });
}
