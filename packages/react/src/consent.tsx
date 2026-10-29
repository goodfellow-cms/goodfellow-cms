import { createConsent } from "./consent-shared.js";
import { useSite } from "./site-context.js";

export const { ConsentFrame, ConsentScript } = createConsent(useSite);
