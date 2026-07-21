import { describe, expect, it, vi } from "vitest";
import {
  type Adapter,
  DisTube,
  DisTubeError,
  ErrorCode,
  type Player,
  type PlayerEvent,
  type PluginContext,
  QueueItem,
  Song,
  type SourcePlugin,
} from "../src";
import { appendItems, IDLE_QUEUE_STATE, startFirst } from "../src/queue/state";

class TestPlayer implements Player {
  readonly calls: string[] = [];
  readonly listeners = new Set<(event: PlayerEvent) => void>();
  failPlay = false;
  failPlayCount = 0;
  failStop = false;

  async play(item: QueueItem): Promise<void> {
    this.calls.push(`play:${item.id}`);
    if (this.failPlay || this.failPlayCount-- > 0) throw new Error("play failed");
  }
  async pause(): Promise<void> {
    this.calls.push("pause");
  }
  async resume(): Promise<void> {
    this.calls.push("resume");
  }
  async stop(): Promise<void> {
    this.calls.push("stop");
    if (this.failStop) throw new Error("stop failed");
  }
  async seek(seconds: number): Promise<void> {
    this.calls.push(`seek:${seconds}`);
  }
  subscribe(listener: (event: PlayerEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  emit(event: PlayerEvent): void {
    for (const listener of this.listeners) listener(event);
  }
}

class TestSource implements SourcePlugin {
  readonly name: string;
  readonly song: Song;
  readonly initialize = vi.fn((_context: PluginContext) => undefined);
  readonly dispose = vi.fn(() => undefined);
  resolveImpl?: (url: string) => Promise<Song | readonly Song[] | undefined>;

  constructor(name = "test-source") {
    this.name = name;
    this.song = new Song({ id: "song", title: "Song", url: "https://media.test/song", duration: 60, source: name });
  }
  search(): Promise<readonly Song[]> {
    return Promise.resolve([this.song]);
  }
  resolve(url: string): Promise<Song | readonly Song[] | undefined> {
    return this.resolveImpl?.(url) ?? Promise.resolve(this.song);
  }
}

function fixture(source = new TestSource(), player = new TestPlayer()) {
  const adapter: Adapter = { createPlayer: vi.fn(async () => player) };
  const distube = new DisTube({ adapter, plugins: [source] });
  const queue = distube.createQueue({ guildId: "guild", channelId: "voice" });
  return { adapter, distube, player, queue, source };
}

describe("media values", () => {
  it("keeps Song metadata and QueueItem dates behaviorally immutable", () => {
    const nested = { tags: ["a"] };
    const song = new Song({
      id: "id",
      title: "title",
      url: "https://example.test",
      duration: 1,
      source: "test",
      metadata: nested,
    });
    nested.tags.push("b");
    expect(song.metadata).toEqual({ tags: ["a"] });
    const item = new QueueItem({ song, addedAt: new Date(1000) });
    const exposed = item.addedAt;
    exposed.setTime(0);
    expect(item.addedAt.getTime()).toBe(1000);
  });

  it("does not expose mutable Map storage", () => {
    const map = new Map([["key", "value"]]);
    const song = new Song({
      id: "map",
      title: "map",
      url: "https://example.test/map",
      duration: 1,
      source: "test",
      metadata: { map },
    });
    const exposed = song.metadata.map as Map<string, string>;
    exposed.set("changed", "yes");
    expect(song.metadata.map).toEqual(new Map([["key", "value"]]));
  });

  it("creates a distinct QueueItem for each occurrence", () => {
    const song = new Song({ id: "id", title: "title", url: "https://example.test", duration: 1, source: "test" });
    expect(new QueueItem({ song }).id).not.toBe(new QueueItem({ song }).id);
  });
});

describe("pure QueueState", () => {
  it("selects the earliest item without mutating the input", () => {
    const song = new Song({ id: "id", title: "title", url: "https://example.test", duration: 1, source: "test" });
    const first = new QueueItem({ song });
    const second = new QueueItem({ song });
    const queued = appendItems(IDLE_QUEUE_STATE, [first, second]);
    const selected = startFirst(queued);
    expect(selected?.item).toBe(first);
    expect(selected?.state).toMatchObject({ current: first, items: [second], status: "playing" });
    expect(queued).toMatchObject({ items: [first, second], status: "idle" });
  });
});

describe("DisTube lifecycle and queues", () => {
  it("validates duplicate plugin names before initialization", () => {
    const one = new TestSource("duplicate");
    const two = new TestSource("duplicate");
    expect(() => new DisTube({ adapter: { createPlayer: vi.fn() }, plugins: [one, two] })).toThrowError(
      expect.objectContaining({ code: ErrorCode.INVALID_ARGUMENT }),
    );
    expect(one.initialize).not.toHaveBeenCalled();
  });

  it("rolls back initialized plugins in reverse order", () => {
    const first = new TestSource("first");
    const second = new TestSource("second");
    second.initialize.mockImplementation(() => {
      throw new Error("init failed");
    });
    expect(() => new DisTube({ adapter: { createPlayer: vi.fn() }, plugins: [first, second] })).toThrowError(
      expect.objectContaining({ code: ErrorCode.PLUGIN_FAILED }),
    );
    expect(first.dispose).toHaveBeenCalledTimes(1);
    expect(second.dispose).not.toHaveBeenCalled();
  });

  it("uses enqueue as the insertion path and publishes committed dotted events", async () => {
    const { distube, queue } = fixture();
    const events: string[] = [];
    distube.on("queue.item.added", event => events.push(`added:${event.item.id}`));
    distube.on("queue.item.started", event => {
      expect(queue.state.current).toBe(event.item);
      events.push(`started:${event.item.id}`);
    });
    const [item] = await queue.enqueue("https://provider.test/item");
    expect(queue.state).toMatchObject({ current: item, items: [], status: "playing" });
    expect(events).toEqual([`added:${item?.id}`, `started:${item?.id}`]);
  });

  it("routes decline then success in configured order", async () => {
    const first = new TestSource("first");
    first.resolveImpl = async () => undefined;
    const second = new TestSource("second");
    const player = new TestPlayer();
    const distube = new DisTube({ adapter: { createPlayer: async () => player }, plugins: [first, second] });
    const queue = distube.createQueue({ guildId: "guild", channelId: "voice" });
    const [item] = await queue.enqueue("https://provider.test/item");
    expect(item?.song.source).toBe("second");
  });

  it("maps accepted source failures once", async () => {
    const source = new TestSource();
    const cause = new Error("provider down");
    source.resolveImpl = async () => {
      throw cause;
    };
    const { queue } = fixture(source);
    await expect(queue.enqueue("https://provider.test/item")).rejects.toMatchObject({
      code: ErrorCode.SOURCE_FAILED,
      cause,
    });
  });

  it("invalidates pending resolution when stop is accepted", async () => {
    const source = new TestSource();
    let resolve!: (song: Song) => void;
    source.resolveImpl = () => new Promise<Song>(done => (resolve = done));
    const { queue } = fixture(source);
    const enqueue = queue.enqueue("https://provider.test/item");
    await Promise.resolve();
    await queue.stop();
    resolve(source.song);
    await expect(enqueue).rejects.toMatchObject({ code: ErrorCode.QUEUE_FAILED });
    expect(queue.state).toBe(IDLE_QUEUE_STATE);
  });

  it("invalidates pending resolution when the queue is destroyed", async () => {
    const source = new TestSource();
    let resolve!: (song: Song) => void;
    source.resolveImpl = () => new Promise<Song>(done => (resolve = done));
    const { distube, queue } = fixture(source);
    const enqueue = queue.enqueue("https://provider.test/item");
    await Promise.resolve();
    await distube.destroyQueue(queue.id);
    resolve(source.song);
    await expect(enqueue).rejects.toMatchObject({ code: ErrorCode.QUEUE_FAILED });
  });

  it("recreates a stopped Player while preserving the queue facade", async () => {
    const source = new TestSource();
    const firstPlayer = new TestPlayer();
    const secondPlayer = new TestPlayer();
    const createPlayer = vi.fn().mockResolvedValueOnce(firstPlayer).mockResolvedValueOnce(secondPlayer);
    const distube = new DisTube({ adapter: { createPlayer }, plugins: [source] });
    const queue = distube.createQueue({ guildId: "guild", channelId: "voice" });
    const [first] = await queue.enqueue(source.song);
    await queue.stop();
    expect(firstPlayer.listeners.size).toBe(0);
    const [second] = await queue.enqueue(source.song);
    expect(createPlayer).toHaveBeenCalledTimes(2);
    expect(queue.state.current).toBe(second);
    firstPlayer.emit({ type: "finished", itemId: first?.id ?? "missing" });
    expect(queue.state.current).toBe(second);
  });

  it("recreates the Player after skip and ignores the stopped Player", async () => {
    const source = new TestSource();
    const firstPlayer = new TestPlayer();
    const secondPlayer = new TestPlayer();
    const createPlayer = vi.fn().mockResolvedValueOnce(firstPlayer).mockResolvedValueOnce(secondPlayer);
    const distube = new DisTube({ adapter: { createPlayer }, plugins: [source] });
    const queue = distube.createQueue({ guildId: "guild", channelId: "voice" });
    const first = (await queue.enqueue(source.song))[0] as QueueItem;
    const second = (await queue.enqueue(source.song))[0] as QueueItem;
    await queue.skip();
    expect(queue.state.current).toBe(second);
    expect(createPlayer).toHaveBeenCalledTimes(2);
    firstPlayer.emit({ type: "finished", itemId: first.id });
    expect(queue.state.current).toBe(second);
  });

  it("advances after a normalized finish and ignores stale item ids", async () => {
    const { distube, player, queue, source } = fixture();
    const other = new Song({
      id: "other",
      title: "Other",
      url: "https://media.test/other",
      duration: 10,
      source: source.name,
    });
    const first = (await queue.enqueue(source.song))[0] as QueueItem;
    const second = (await queue.enqueue(other))[0] as QueueItem;
    player.emit({ type: "finished", itemId: "stale" });
    expect(queue.state.current).toBe(first);
    player.emit({ type: "finished", itemId: first.id });
    await vi.waitFor(() => expect(queue.state.current).toBe(second));
    expect(player.calls).toContain(`play:${second.id}`);
    await distube.shutdown();
  });

  it("publishes failure once and advances after a failed start", async () => {
    const player = new TestPlayer();
    player.failPlayCount = 1;
    const source = new TestSource();
    const { distube, queue } = fixture(source, player);
    const failed: string[] = [];
    distube.on("queue.item.failed", event => failed.push(event.item.song.id));
    const first = new Song({
      id: "first",
      title: "First",
      url: "https://media.test/first",
      duration: 10,
      source: source.name,
    });
    const second = new Song({
      id: "second",
      title: "Second",
      url: "https://media.test/second",
      duration: 10,
      source: source.name,
    });
    source.resolveImpl = async () => [first, second];
    await queue.enqueue("https://provider.test/playlist");
    await vi.waitFor(() => expect(queue.state.current?.song.id).toBe("second"));
    expect(failed).toEqual(["first"]);
  });

  it("commits controls only after Player success", async () => {
    const { player, queue } = fixture();
    await queue.enqueue("https://provider.test/item");
    await queue.pause();
    expect(queue.state.status).toBe("paused");
    await queue.resume();
    await queue.seek(20);
    expect(player.calls).toEqual(expect.arrayContaining(["pause", "resume", "seek:20"]));
  });

  it("returns the same shutdown Promise and disposes plugins once", async () => {
    const { distube, source } = fixture();
    const first = distube.shutdown();
    expect(distube.shutdown()).toBe(first);
    await first;
    expect(source.dispose).toHaveBeenCalledTimes(1);
    expect(() => distube.createQueue({ guildId: "other", channelId: "voice" })).toThrowError(
      expect.objectContaining({ code: ErrorCode.QUEUE_FAILED }),
    );
  });

  it("releases the active Player during shutdown and ignores its late outcomes", async () => {
    const { distube, player, queue, source } = fixture();
    const [active] = await queue.enqueue(source.song);
    const failed = vi.fn();
    distube.on("queue.item.failed", failed);
    await distube.shutdown();
    expect(player.calls).toContain("stop");
    expect(player.listeners.size).toBe(0);
    player.emit({ type: "failed", itemId: active?.id ?? "missing", error: new Error("late") });
    expect(failed).not.toHaveBeenCalled();
  });

  it("attempts every plugin disposal before reporting shutdown failure", async () => {
    const first = new TestSource("first");
    const second = new TestSource("second");
    first.dispose.mockImplementation(() => {
      throw new Error("first dispose");
    });
    second.dispose.mockImplementation(() => {
      throw new Error("second dispose");
    });
    const distube = new DisTube({ adapter: { createPlayer: vi.fn() }, plugins: [first, second] });
    await expect(distube.shutdown()).rejects.toMatchObject({ code: ErrorCode.PLUGIN_FAILED });
    expect(first.dispose).toHaveBeenCalledTimes(1);
    expect(second.dispose).toHaveBeenCalledTimes(1);
  });

  it("captures listener rejection without rolling back state", async () => {
    const diagnostic = vi.fn();
    const source = new TestSource();
    const distube = new DisTube({
      adapter: { createPlayer: async () => new TestPlayer() },
      plugins: [source],
      onDiagnostic: diagnostic,
    });
    const queue = distube.createQueue({ guildId: "guild", channelId: "voice" });
    distube.on("queue.item.added", async () => {
      throw new Error("listener failed");
    });
    await queue.enqueue(source.song);
    await vi.waitFor(() => expect(diagnostic).toHaveBeenCalled());
    expect(queue.state.current?.song).toBe(source.song);
  });
});

describe("errors", () => {
  it("has exactly five public codes", () => {
    expect(Object.values(ErrorCode)).toEqual([
      "INVALID_ARGUMENT",
      "SOURCE_FAILED",
      "VOICE_FAILED",
      "PLUGIN_FAILED",
      "QUEUE_FAILED",
    ]);
    expect(new DisTubeError(ErrorCode.QUEUE_FAILED, "failed")).toBeInstanceOf(Error);
  });
});
