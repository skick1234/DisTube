import { describe, expect, it } from "vitest";
import { CleanupBarrier } from "../src/queue/cleanup";

function deferred(): Readonly<{ promise: Promise<void>; resolve: () => void }> {
  let resolve!: () => void;
  const promise = new Promise<void>(done => (resolve = done));
  return { promise, resolve };
}

describe("CleanupBarrier", () => {
  it("joins cleanup added before settlement and preserves registration order", async () => {
    const barrier = new CleanupBarrier();
    const gate = deferred();
    barrier.add(async () => {
      await gate.promise;
      throw new Error("first");
    });
    const settling = barrier.settle();
    expect(
      barrier.add(async () => {
        throw new Error("second");
      }),
    ).toBe(true);
    gate.resolve();
    await expect(settling).resolves.toEqual([
      expect.objectContaining({ message: "first" }),
      expect.objectContaining({ message: "second" }),
    ]);
    expect(barrier.add(() => undefined)).toBe(false);
  });
});
