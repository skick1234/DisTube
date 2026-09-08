import { describe, expect, it } from "vitest";
import { Mailbox } from "../src/queue/mailbox";

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
});
