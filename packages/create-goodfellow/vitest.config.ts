import { configDefaults, defineConfig, mergeConfig } from "vitest/config";
import shared from "../../vitest.shared.ts";

// The bundled templates are sites of their own, whose tests run in their own folders, not here.
export default mergeConfig(shared, defineConfig({ test: { exclude: [...configDefaults.exclude, "templates/**"] } }));
