import { createConsent } from "./consent-shared.js";
import { useSite } from "./site-context.server.js";

export const { ConsentFrame, ConsentScript } = createConsent(useSite);
