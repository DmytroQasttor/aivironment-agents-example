import { build } from "esbuild";
import { nodeExternalsPlugin } from "esbuild-node-externals";

await build({
  entryPoints: ["src/server.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node18",
  outdir: "dist",
  sourcemap: true,
  plugins: [nodeExternalsPlugin()],
});
