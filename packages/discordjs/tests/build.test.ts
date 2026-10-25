import { expect, it } from "vitest";
import { bundle } from "../../voice-core/tests/support/bundle";

it("bundles voice-core into its build, worker included, without naming it", async () => {
  const output = await bundle(new URL("..", import.meta.url));

  expect([...output.keys()]).toEqual(expect.arrayContaining(["index.mjs", "index.d.mts", "worker.mjs"]));
  expect([...output].filter(([, text]) => text.includes("voice-core")).map(([file]) => file)).toEqual([]);
}, 60_000);
