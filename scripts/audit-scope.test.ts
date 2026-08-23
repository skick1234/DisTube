import { describe, expect, test } from "bun:test";
import { type Lockfile, publishedDependencies, reachableProductionPackages } from "./audit-scope";

/** How the core packages are actually shaped: no dependencies, one peer per Discord library. */
const adapter = { name: "@distube/discordjs", peerDependencies: { "discord.js": "^14.26.0" } };

const lockfile: Lockfile = {
  packages: {
    "discord.js": ["discord.js@14.27.0", "", { dependencies: { undici: "6.27.0" } }],
    undici: ["undici@6.27.0", "", {}],
    vitest: ["vitest@4.0.0", "", { dependencies: { vite: "7.3.1" } }],
  },
};

describe("publishedDependencies", () => {
  test("counts a peer as shipped", () => {
    expect(publishedDependencies(adapter)).toEqual(["discord.js"]);
  });

  test("keeps dependencies and optional dependencies", () => {
    expect(
      publishedDependencies({
        dependencies: { a: "1" },
        optionalDependencies: { b: "1" },
        peerDependencies: { c: "1" },
      }),
    ).toEqual(["a", "b", "c"]);
  });
});

describe("reachableProductionPackages", () => {
  test("reaches a peer and everything the peer installs", () => {
    // Reading only `dependencies` produced an empty set here, which is why no advisory could block.
    expect([...reachableProductionPackages([adapter], lockfile)].sort()).toEqual(["discord.js", "undici"]);
  });

  test("leaves tooling out of the production set", () => {
    const production = reachableProductionPackages([adapter], lockfile);
    expect(production.has("vitest")).toBe(false);
    expect(production.has("vite")).toBe(false);
  });

  test("does not seed from a private manifest", () => {
    const workspaceRoot = { name: "root", private: true, devDependencies: { vitest: "^4" } };
    expect(reachableProductionPackages([workspaceRoot], lockfile).size).toBe(0);
  });

  test("follows a workspace sibling into its own peers", () => {
    const consumer = { name: "@distube/eris", dependencies: { "@distube/discordjs": "workspace:*" } };
    expect(reachableProductionPackages([consumer, adapter], lockfile).has("discord.js")).toBe(true);
  });
});
