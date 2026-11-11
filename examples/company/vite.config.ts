// How vinext builds the site into a Cloudflare Worker (`npm run build`). `npm run dev` still runs Next.js.
import { cloudflare } from "@cloudflare/vite-plugin";
import { workersCacheCdnAdapter } from "@vinext/cloudflare/cache/workers-cache-cdn-adapter";
import { imagesOptimizer } from "@vinext/cloudflare/images/images-optimizer";
import vinext from "vinext";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [
    vinext({
      // A page renders from the content repository the first time it's visited, and Workers Cache keeps it until
      // a publish says it changed (revalidatePath() in the admin panel's API), so other visits render nothing.
      cache: { cdn: workersCacheCdnAdapter() },
      images: { optimizer: imagesOptimizer() },
    }),
    // Pages render in workerd, Cloudflare's runtime, as they will on Cloudflare.
    cloudflare({ viteEnvironment: { name: "rsc", childEnvironments: ["ssr"] } }),
  ],
});
