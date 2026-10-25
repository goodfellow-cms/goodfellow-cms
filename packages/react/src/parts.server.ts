import { createUseParts } from "./parts-shared.js";
import { useSite } from "./site-context.server.js";

export const useParts = createUseParts(useSite);
