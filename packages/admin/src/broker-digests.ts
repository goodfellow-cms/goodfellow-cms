import type { BrokerDigests } from "@goodfellow-cms/core";

/** Set by the admin panel's build from the token broker built with it (`@goodfellow-cms/broker`'s `site/files.json`). */
declare const __GOODFELLOW_BROKER_DIGESTS__: BrokerDigests | undefined;

/**
 * The SHA-256 of each file of the token broker's page released with this admin panel, which **Add a token broker**
 * checks what it downloads against, or `undefined` where a build bundled the admin panel's source without them.
 */
export const BROKER_DIGESTS: BrokerDigests | undefined =
  typeof __GOODFELLOW_BROKER_DIGESTS__ === "object" ? __GOODFELLOW_BROKER_DIGESTS__ : undefined;
