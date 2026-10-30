import { describe, expect, it } from "vitest";
import type { DisTubeQueue, Song } from "../src";
import { type FakePlayer, FakeSource, GUILD, media, record, settle, setup, VOICE_CHANNEL } from "./support/harness";

const TARGET = { guildId: GUILD, id: VOICE_CHANNEL };

/** A playing queue holding `ids` in order, with the configured history ceiling. */
async function playing(ids: readonly string[], historySize?: number) {
  const source = new FakeSource("source");
  source.search.mockImplementation(async query => [media("source", query)]);
  const harness = { ...setup([source], { historySize }), source };
  const { queue } = await harness.distube.play(TARGET, ids[0] as string);
  for (const id of ids.slice(1)) await queue.add(id);
  await settle();
  return { harness, queue, player: harness.engine.players[0] as FakePlayer };
}

const remembered = (queue: DisTubeQueue): string[] => queue.history.map(item => item.song.id);

describe("bounded history", () => {
  it.each([
    {
      name: "a ceiling of three",
      historySize: 3,
      ids: ["w0", "w1", "w2", "w3", "w4"],
      history: ["w1", "w2", "w3"],
    },
    {
      name: "the default ceiling of ten",
      historySize: undefined,
      ids: Array.from({ length: 13 }, (_, index) => `w${index}`),
      history: ["w2", "w3", "w4", "w5", "w6", "w7", "w8", "w9", "w10", "w11"],
    },
  ])("evicts the oldest entry past $name, newest last", async ({ historySize, ids, history }) => {
    const { harness, queue, player } = await playing(ids, historySize);
    for (let round = 1; round < ids.length; round += 1) {
      player.finish();
      await settle();
    }
    expect(remembered(queue)).toEqual(history);
    expect(queue.current?.song.id).toBe(ids.at(-1));
    await harness.distube.dispose();
  });

  it("keeps nothing at zero, so previous has nothing to return to", async () => {
    const { harness, queue, player } = await playing(["a", "b"], 0);
    const events = record(harness.distube, ["queue.item.finished"]);
    player.finish();
    await settle();
    expect(remembered(queue)).toEqual([]);
    expect(events).toEqual(["queue.item.finished"]);
    await expect(queue.previous()).rejects.toMatchObject({ code: "INVALID_STATE" });
    await harness.distube.dispose();
  });

  it("does not remember a failed item", async () => {
    const { harness, queue, player } = await playing(["a", "b", "c"]);
    player.fail(new Error("decoder"));
    await settle();
    expect(queue.current?.song.id).toBe("b");
    player.finish();
    await settle();
    expect(remembered(queue)).toEqual(["b"]);
    await harness.distube.dispose();
  });

  it("appends the skipped item to history without publishing queue.item.finished", async () => {
    const { harness, queue } = await playing(["a", "b"]);
    const events = record(harness.distube, ["queue.item.finished", "queue.item.started"]);

    await queue.skip();
    await settle();

    expect(events).toEqual(["queue.item.started"]);
    expect(queue.history.map(item => item.song.id)).toEqual(["a"]);
    await harness.distube.dispose();
  });

  it("is cleared with the queue and does not survive on the voice", async () => {
    const { harness, queue } = await playing(["a", "b"]);
    await queue.skip();
    await settle();
    expect(remembered(queue)).toEqual(["a"]);
    await queue.stop();
    expect(queue.history).toEqual([]);
    const { queue: replacement } = await harness.distube.play(TARGET, "c");
    expect(replacement.history).toEqual([]);
    expect(harness.distube.voices.get(GUILD)).toBeDefined();
    await harness.distube.dispose();
  });
});

describe("related media", () => {
  it("seeds autoplay with the last finished item even when history keeps nothing", async () => {
    const { harness, queue, player } = await playing(["a"], 0);
    harness.source.related.mockResolvedValue(media("source", "related"));
    queue.setAutoplay(true);
    player.finish();
    await settle();

    expect(harness.source.related).toHaveBeenCalledWith(
      expect.objectContaining({ id: "a" }),
      expect.objectContaining({ exclude: [] }),
    );
    expect(queue.current?.song.id).toBe("related");
    await harness.distube.dispose();
  });

  it("passes the bounded history as context.exclude to the owning source", async () => {
    const { harness, queue, player } = await playing(["a", "b"]);
    const excluded: Song[][] = [];
    harness.source.related.mockImplementation(async (_song, context) => {
      excluded.push([...context.exclude]);
      return media("source", "related");
    });
    queue.setAutoplay(true);
    player.finish();
    await settle();
    player.finish();
    await settle();

    expect(excluded).toHaveLength(1);
    expect(excluded[0]?.map(song => song.id)).toEqual(["a", "b"]);
    expect(queue.current?.song.id).toBe("related");
    await harness.distube.dispose();
  });
});
