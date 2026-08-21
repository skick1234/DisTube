import { describe, expect, it } from "vitest";
import { Mailbox } from "../src/queue/mailbox";
import { immutableClone } from "../src/utils/immutable";

describe("private utility behavior", () => {
  it("drains reentrant mailbox posts in FIFO order and recovers after a throw", () => {
    const seen: number[] = [];
    let shouldThrow = true;
    const mailbox = new Mailbox<number>(value => {
      seen.push(value);
      if (value === 1) mailbox.post(2);
      if (value === 3 && shouldThrow) {
        shouldThrow = false;
        throw new Error("handler failed");
      }
    });

    mailbox.post(1);
    expect(seen).toEqual([1, 2]);
    expect(() => mailbox.post(3)).toThrow("handler failed");
    mailbox.post(4);
    expect(seen).toEqual([1, 2, 3, 4]);
  });

  it("clones Dates, Sets, arrays, symbols, and cyclic references", () => {
    const symbol = Symbol("field");
    const source: Record<PropertyKey, unknown> = {
      date: new Date("2026-01-01T00:00:00Z"),
      set: new Set([{ value: 1 }]),
      array: [{ nested: true }],
      [symbol]: "symbol-value",
    };
    source.self = source;
    const clone = immutableClone(source);

    expect(clone).not.toBe(source);
    expect(clone.date).toEqual(source.date);
    expect(clone.date).not.toBe(source.date);
    expect(clone.set).toEqual(source.set);
    expect(clone.set).not.toBe(source.set);
    expect(clone.array).toEqual(source.array);
    expect(clone[symbol]).toBe("symbol-value");
    expect(clone.self).toBe(clone);
    expect(Object.isFrozen(clone)).toBe(true);
  });
});
