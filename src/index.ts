/**
 * The current version that you are currently using.
 *
 * Note to developers:
 * This needs to explicitly be `string` so it is not typed as a "const string" that gets injected by esbuild
 */
// eslint-disable-next-line @typescript-eslint/no-inferrable-types
export const version: string = "[VI]{{inject}}[/VI]";

export * from "./type";
export * from "./constant";
export * from "./struct";
export * from "./util";
export * from "./core";
export { DisTube, DisTube as default } from "./DisTube";
