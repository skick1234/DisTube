import { describe, expect, it } from "vitest";
import { DisTube, type QueueItem } from "../src";
import { deferred, FakeAdapter, FakeEngine, FakeSource, GUILD, media, settle, VOICE_CHANNEL } from "./support/harness";

interface Requester {
  readonly requestedBy: string;
}

const TARGET = { guildId: GUILD, voiceChannelId: VOICE_CHANNEL };

/** A client whose caller metadata is declared, so every hand-back is typed without a cast. */
function typedClient(): DisTube<Requester> {
  const source = new FakeSource("source");
  source.search.mockImplementation(async query => [media("source", query)]);
  return new DisTube<Requester>({ adapter: new FakeAdapter(new FakeEngine()), plugins: [source] });
}

describe("typed caller metadata", () => {
  it("reads the caller's own shape off items, queues, events, and history with no cast", async () => {
    const distube = typedClient();
    const added = deferred<Requester>();
    // The listener parameter is typed by the client, so this property read is what proves the threading.
    distube.on("queue.item.added", event => added.resolve(event.item.metadata));

    const { queue, items } = await distube.play(TARGET, "a", { metadata: { requestedBy: "skick" } });
    await settle();

    expect(await added.promise).toEqual({ requestedBy: "skick" });
    expect(items[0]?.metadata.requestedBy).toBe("skick");

    const looked: QueueItem<Requester> | undefined = distube.getQueue(GUILD)?.state.current;
    expect(looked?.metadata.requestedBy).toBe("skick");

    await queue.enqueue("b", { metadata: { requestedBy: "someone else" } });
    expect(queue.state.items[0]?.metadata.requestedBy).toBe("someone else");

    const voice = distube.voices.get(GUILD);
    await queue.skip();
    await settle();
    expect(voice?.previousSongs[0]?.metadata.requestedBy).toBe("skick");
    await distube.shutdown();
  });

  it("stores the caller's value by reference without copying or interpreting it", async () => {
    const distube = typedClient();
    const metadata: Requester = { requestedBy: "skick" };

    const { items } = await distube.play(TARGET, "a", { metadata });

    expect(items[0]?.metadata).toBe(metadata);
    await distube.shutdown();
  });
});
