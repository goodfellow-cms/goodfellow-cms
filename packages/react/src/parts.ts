import { createUseParts } from "./parts-shared.js";
import { useSite } from "./site-context.js";

export const useParts = createUseParts(useSite);
