import { describe, expect, it } from "vitest";
import { Events, Filters, QueueStatus, RepeatMode } from "../src";

// Enum values are frozen public contract (ADR 0048): renaming a value is breaking
// even when the member name survives, so the closed sets are asserted literally.
describe("public vocabulary", () => {
  it("names the ten public events", () => {
    expect(Object.values(Events)).toEqual([
      "queue.created",
      "queue.item.added",
      "queue.playlist.added",
      "queue.item.started",
      "queue.item.finished",
      "queue.item.failed",
      "queue.finished",
      "queue.autoplay.failed",
      "queue.deleted",
      "voice.disconnected",
    ]);
  });

  it("names the closed repeat and status sets", () => {
    expect(Object.values(RepeatMode)).toEqual(["off", "song", "queue"]);
    expect(Object.values(QueueStatus)).toEqual(["idle", "playing", "paused"]);
  });

  it("names the conventional filters every engine must define", () => {
    expect(Object.values(Filters)).toEqual([
      "3d",
      "bassboost",
      "earwax",
      "echo",
      "flanger",
      "gate",
      "haas",
      "karaoke",
      "mcompand",
      "nightcore",
      "phaser",
      "reverse",
      "surround",
      "tremolo",
      "vaporwave",
    ]);
  });

  it("keeps members assignable to their literal strings", () => {
    const started: "queue.item.started" = Events.QueueItemStarted;
    const paused: "paused" = QueueStatus.Paused;
    expect([started, paused]).toEqual(["queue.item.started", "paused"]);
  });
});
