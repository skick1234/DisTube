import { esbuildPluginVersionInjector } from "esbuild-plugin-version-injector";
import { defineConfig } from "tsup";

export default defineConfig({
  platform: "node",
  clean: true,
  dts: true,
  entry: ["src/index.ts"],
  format: ["cjs", "esm"],
  minify: false,
  keepNames: true,
  skipNodeModulesBundle: true,
  sourcemap: true,
  target: "es2022",
  shims: true,
  cjsInterop: true,
  splitting: false,
  treeshake: false,
  outDir: "dist",
  terserOptions: {
    mangle: false,
    keep_classnames: true,
    keep_fnames: true,
  },
  esbuildPlugins: [esbuildPluginVersionInjector()],
});
