import { describe, expect, expectTypeOf, it } from "vitest";
import { type DisTube, Song } from "../src";
import { QueueItem } from "../src/media";

class Requester {
  constructor(public requestedBy: string) {}

  label(): string {
    return this.requestedBy;
  }
}

const song = () => new Song({ source: "source", id: "a", name: "A", url: "https://example.test/a" });

describe("typed caller metadata", () => {
  it("keeps caller methods, identity, and mutable contents", () => {
    const metadata = new Requester("skick");
    const item = new QueueItem({ song: song(), metadata });
    metadata.requestedBy = "someone else";
    expect(item.metadata).toBe(metadata);
    expect(item.metadata?.label()).toBe("someone else");
    expect(Object.isFrozen(metadata)).toBe(false);
  });

  it("types optional metadata consistently on client results", () => {
    type Result = Awaited<ReturnType<DisTube<Requester>["play"]>>;
    expectTypeOf<Result["items"][number]["metadata"]>().toEqualTypeOf<Requester | undefined>();
    expect(new QueueItem<Requester>({ song: song() }).metadata).toBeUndefined();
  });
});
