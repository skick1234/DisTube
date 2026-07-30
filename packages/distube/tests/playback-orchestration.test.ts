import { describe, expect, it, vi } from "vitest";
import {
  type Adapter,
  DisTube,
  ErrorCode,
  type PlaybackContext,
  type PlaybackPreparation,
  type PlaybackRequest,
  type Player,
  type PlayerEvent,
  type PluginContext,
  Song,
  type SourceOperationOptions,
  type SourcePlugin,
} from "../src";

interface Deferred<Value> {
  readonly promise: Promise<Value>;
  readonly resolve: (value: Value) => void;
  readonly reject: (error: unknown) => void;
}

function deferred<Value>(): Deferred<Value> {
  let resolve!: (value: Value) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<Value>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

function media(source: string, id = `${source}-song`): Song {
  return new Song({
    id,
    title: `Title ${id}`,
    url: `https://${source}.example/media/${id}`,
    duration: 60,
    source,
  });
}

class FakeSource implements SourcePlugin {
  readonly initialize = vi.fn((_context: PluginContext) => undefined);
  readonly dispose = vi.fn(() => undefined);
  readonly search = vi.fn(async (_query: string, _options?: SourceOperationOptions): Promise<readonly Song[]> => []);
  readonly resolve = vi.fn(
    async (_url: string, _options?: SourceOperationOptions): Promise<Song | readonly Song[] | undefined> => undefined,
  );
  readonly preparePlayback = vi.fn(
    async (_song: Song, _context: PlaybackContext): Promise<PlaybackPreparation> => ({
      kind: "resource",
      resource: { kind: "url", url: `https://stream.example/${this.name}`, dispose: vi.fn() },
    }),
  );

  constructor(readonly name: string) {}
}

class FakePlayer implements Player {
  readonly requests: PlaybackRequest[] = [];
  readonly listeners = new Set<(event: PlayerEvent) => void>();
  readonly pause = vi.fn(async () => undefined);
  readonly resume = vi.fn(async () => undefined);
  readonly seek = vi.fn(async (_seconds: number) => undefined);
  readonly stop = vi.fn(async (): Promise<void> => undefined);
  readonly play = vi.fn(async (request: PlaybackRequest) => {
    this.requests.push(request);
  });

  subscribe(listener: (event: PlayerEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(event: PlayerEvent): void {
    for (const listener of this.listeners) listener(event);
  }
}

function setup(sources: readonly FakeSource[], createPlayer: Adapter["createPlayer"] = async () => new FakePlayer()) {
  const adapter: Adapter = { createPlayer: vi.fn(createPlayer) };
  const diagnostics = vi.fn();
  const distube = new DisTube({ adapter, plugins: sources, onDiagnostic: diagnostics });
  const queue = distube.createQueue({ guildId: "guild", channelId: "voice" });
  return { adapter, diagnostics, distube, queue };
}

describe("mailbox enqueue ordering", () => {
  it("commits concurrent resolution in acceptance order despite out-of-order completion", async () => {
    const source = new FakeSource("source");
    const first = deferred<Song>();
    const second = deferred<Song>();
    source.resolve.mockImplementation(url => (url.endsWith("first") ? first.promise : second.promise));
    const { queue } = setup([source]);
    const firstEnqueue = queue.enqueue("https://input.example/first");
    const secondEnqueue = queue.enqueue("https://input.example/second");
    second.resolve(media(source.name, "second"));
    await Promise.resolve();
    expect(queue.state.items).toEqual([]);
    first.resolve(media(source.name, "first"));
    const [[firstItem], [secondItem]] = await Promise.all([firstEnqueue, secondEnqueue]);
    expect(queue.state.items.map(item => item.id)).toEqual([firstItem?.id, secondItem?.id]);
  });

  it("advances the commit cursor after an earlier resolution failure", async () => {
    const source = new FakeSource("source");
    const first = deferred<Song>();
    const second = deferred<Song>();
    source.resolve.mockImplementation(url => (url.endsWith("first") ? first.promise : second.promise));
    const { queue } = setup([source]);
    const failed = queue.enqueue("https://input.example/first");
    const succeeds = queue.enqueue("https://input.example/second");
    second.resolve(media(source.name, "second"));
    first.reject(new Error("first failed"));
    await expect(failed).rejects.toMatchObject({ code: ErrorCode.SOURCE_FAILED });
    const [item] = await succeeds;
    expect(queue.state.items[0]).toBe(item);
  });

  it("terminal stop aborts every uncommitted resolution without blocking", async () => {
    const source = new FakeSource("source");
    const pending = deferred<Song>();
    let signal: AbortSignal | undefined;
    source.resolve.mockImplementation((_url, options) => {
      signal = options?.signal;
      return pending.promise;
    });
    const { distube, queue } = setup([source]);
    const added = vi.fn();
    distube.on("queue.item.added", added);
    const enqueue = queue.enqueue("https://input.example/pending");
    await vi.waitFor(() => expect(signal).toBeDefined());
    await queue.stop();
    expect(signal?.aborted).toBe(true);
    await expect(enqueue).rejects.toMatchObject({ code: ErrorCode.QUEUE_FAILED });
    pending.resolve(media(source.name));
    await Promise.resolve();
    expect(queue.state).toMatchObject({ items: [], status: "idle" });
    expect(added).not.toHaveBeenCalled();
  });
});

describe("playback preparation and fallback", () => {
  it("uses a fresh prepared URL and never the canonical Song URL", async () => {
    const source = new FakeSource("youtube");
    const song = media(source.name);
    source.resolve.mockResolvedValue(song);
    const dispose = vi.fn();
    source.preparePlayback.mockResolvedValue({
      kind: "resource",
      resource: { kind: "url", url: "https://stream.example/fresh?signature=private", dispose },
    });
    const player = new FakePlayer();
    const { queue } = setup([source], async () => player);
    const [item] = await queue.enqueue(song);
    await vi.waitFor(() => expect(player.requests).toHaveLength(1));
    expect(player.requests[0]).toEqual({
      itemId: item?.id,
      resource: expect.objectContaining({ url: "https://stream.example/fresh?signature=private" }),
    });
    expect(player.requests[0]?.resource.url).not.toBe(song.url);
    expect(source.preparePlayback.mock.calls[0]?.[1].signal).toBeInstanceOf(AbortSignal);
    player.emit({ type: "finished", itemId: item?.id ?? "missing" });
    await vi.waitFor(() => expect(dispose).toHaveBeenCalledTimes(1));
  });

  it("executes explicit fallback in configured order and preserves original item identity", async () => {
    const spotify = new FakeSource("spotify");
    const youtube = new FakeSource("youtube");
    const soundcloud = new FakeSource("soundcloud");
    const original = media("spotify", "original");
    const candidate = media("soundcloud", "candidate");
    spotify.preparePlayback.mockResolvedValue({ kind: "search", query: "Title Artist One Artist Two" });
    youtube.search.mockResolvedValue([]);
    soundcloud.search.mockResolvedValue([candidate]);
    const player = new FakePlayer();
    const { distube, queue } = setup([spotify, youtube, soundcloud], async () => player);
    const started = vi.fn();
    distube.on("queue.item.started", started);
    const [item] = await queue.enqueue(original);
    await vi.waitFor(() => expect(player.requests).toHaveLength(1));
    expect(youtube.search).toHaveBeenCalledWith(
      "Title Artist One Artist Two",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(soundcloud.search).toHaveBeenCalledWith("Title Artist One Artist Two", expect.anything());
    expect(player.requests[0]?.itemId).toBe(item?.id);
    expect(player.requests[0]?.resource.url).toContain("soundcloud");
    await vi.waitFor(() => expect(started).toHaveBeenCalledWith(expect.objectContaining({ item })));
    expect(queue.state.current?.song).toBe(original);
  });

  it("tries only five ranked candidates and preserves ordered fallback causes", async () => {
    const spotify = new FakeSource("spotify");
    const youtube = new FakeSource("youtube");
    const soundcloud = new FakeSource("soundcloud");
    spotify.preparePlayback.mockResolvedValue({ kind: "search", query: "query" });
    youtube.search.mockRejectedValue(new Error("youtube search"));
    const candidates = Array.from({ length: 7 }, (_, index) => media("soundcloud", `candidate-${index}`));
    soundcloud.search.mockResolvedValue(candidates);
    soundcloud.preparePlayback.mockImplementation(async song => {
      throw new Error(`prepare ${song.id}`);
    });
    const { distube, queue } = setup([spotify, youtube, soundcloud]);
    const failed = vi.fn();
    distube.on("queue.item.failed", failed);
    await queue.enqueue(media("spotify", "original"));
    await vi.waitFor(() => expect(failed).toHaveBeenCalledTimes(1));
    expect(soundcloud.preparePlayback).toHaveBeenCalledTimes(5);
    const error = failed.mock.calls[0]?.[0].error;
    expect(error).toMatchObject({ code: ErrorCode.SOURCE_FAILED, cause: expect.any(AggregateError) });
    expect((error.cause as AggregateError).errors.map((cause: Error) => cause.message)).toEqual([
      "youtube search",
      ...candidates.slice(0, 5).map(song => `prepare ${song.id}`),
    ]);
  });

  it("does not fallback after original preparation or Player failure", async () => {
    const original = new FakeSource("original");
    const target = new FakeSource("target");
    const player = new FakePlayer();
    const { distube, queue } = setup([original, target], async () => player);
    const failures: ErrorCode[] = [];
    distube.on("queue.item.failed", event => failures.push(event.error.code));
    original.preparePlayback.mockRejectedValueOnce(new Error("provider failed"));
    await queue.enqueue(media("original", "provider-failure"));
    await vi.waitFor(() => expect(failures).toEqual([ErrorCode.SOURCE_FAILED]));
    expect(target.search).not.toHaveBeenCalled();

    const dispose = vi.fn();
    original.preparePlayback.mockResolvedValueOnce({
      kind: "resource",
      resource: { kind: "url", url: "https://stream.example/failure", dispose },
    });
    player.play.mockRejectedValueOnce(new Error("voice failed"));
    await queue.enqueue(media("original", "player-failure"));
    await vi.waitFor(() => expect(failures).toEqual([ErrorCode.SOURCE_FAILED, ErrorCode.VOICE_FAILED]));
    expect(target.search).not.toHaveBeenCalled();
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it("rejects mismatched fallback ownership before candidate preparation", async () => {
    const spotify = new FakeSource("spotify");
    const youtube = new FakeSource("youtube");
    spotify.preparePlayback.mockResolvedValue({ kind: "search", query: "query" });
    youtube.search.mockResolvedValue([media("spotify", "wrong-owner")]);
    const { distube, queue } = setup([spotify, youtube]);
    const failed = vi.fn();
    distube.on("queue.item.failed", failed);
    await queue.enqueue(media("spotify", "original"));
    await vi.waitFor(() => expect(failed).toHaveBeenCalledTimes(1));
    expect(youtube.preparePlayback).not.toHaveBeenCalled();
    expect(failed.mock.calls[0]?.[0].error.code).toBe(ErrorCode.SOURCE_FAILED);
  });
});

describe("terminal authority and cleanup", () => {
  it("disposes malformed returned resources once and redacts their URL from public errors", async () => {
    const source = new FakeSource("source");
    const dispose = vi.fn();
    const secret = "file:///private/audio?token=secret";
    source.preparePlayback.mockResolvedValue({
      kind: "resource",
      resource: { kind: "url", url: secret, dispose },
    });
    const { distube, queue } = setup([source]);
    const failed = vi.fn();
    distube.on("queue.item.failed", failed);
    await queue.enqueue(media("source"));
    await vi.waitFor(() => expect(failed).toHaveBeenCalledTimes(1));
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(failed.mock.calls[0]?.[0].error).toMatchObject({ code: ErrorCode.SOURCE_FAILED });
    expect(failed.mock.calls[0]?.[0].error.message).not.toContain(secret);
  });

  it("rejects a non-cooperative late Player acknowledgement and disposes exactly once", async () => {
    const source = new FakeSource("source");
    const dispose = vi.fn();
    source.preparePlayback.mockResolvedValue({
      kind: "resource",
      resource: { kind: "url", url: "https://stream.example/late-player", dispose },
    });
    const player = new FakePlayer();
    const activation = deferred<void>();
    player.play.mockImplementation(async request => {
      player.requests.push(request);
      await activation.promise;
    });
    const { distube, queue } = setup([source], async () => player);
    const started = vi.fn();
    distube.on("queue.item.started", started);
    await queue.enqueue(media("source"));
    await vi.waitFor(() => expect(player.requests).toHaveLength(1));
    await queue.stop();
    activation.resolve();
    await vi.waitFor(() => expect(dispose).toHaveBeenCalledTimes(1));
    expect(started).not.toHaveBeenCalled();
    expect(queue.state.current).toBeUndefined();
  });

  it("removes a selected waiting item, aborts preparation, and disposes a late resource once", async () => {
    const source = new FakeSource("source");
    const preparation = deferred<PlaybackPreparation>();
    let signal: AbortSignal | undefined;
    source.preparePlayback.mockImplementation((_song, context) => {
      signal = context.signal;
      return preparation.promise;
    });
    const player = new FakePlayer();
    const { distube, queue } = setup([source], async () => player);
    const terminal = vi.fn();
    distube.on("queue.item.failed", terminal);
    const [item] = await queue.enqueue(media("source", "selected"));
    await vi.waitFor(() => expect(signal).toBeDefined());
    await expect(queue.remove(item?.id ?? "missing")).resolves.toBe(item);
    expect(signal?.aborted).toBe(true);
    const dispose = vi.fn();
    preparation.resolve({
      kind: "resource",
      resource: { kind: "url", url: "https://stream.example/late", dispose },
    });
    await vi.waitFor(() => expect(dispose).toHaveBeenCalledTimes(1));
    expect(player.requests).toHaveLength(0);
    expect(terminal).not.toHaveBeenCalled();
  });

  it("clears logical state before terminal stop cleanup settles", async () => {
    const source = new FakeSource("source");
    const player = new FakePlayer();
    const teardown = deferred<void>();
    player.stop.mockImplementation(() => teardown.promise);
    const { queue } = setup([source], async () => player);
    const [item] = await queue.enqueue(media("source"));
    await vi.waitFor(() => expect(queue.state.current).toBe(item));
    const stopping = queue.stop();
    expect(queue.state).toMatchObject({ items: [], status: "idle" });
    expect(queue.state.current).toBeUndefined();
    await vi.waitFor(() => expect(player.stop).toHaveBeenCalledTimes(1));
    teardown.resolve();
    await stopping;
    const [next] = await queue.enqueue(media("source", "next"));
    await vi.waitFor(() => expect(queue.state.current).toBe(next));
  });

  it("stops a Player that arrives after stop and never resurrects playback", async () => {
    const source = new FakeSource("source");
    const creation = deferred<Player>();
    const late = new FakePlayer();
    const { queue } = setup([source], () => creation.promise);
    await queue.enqueue(media("source"));
    await vi.waitFor(() => expect(creation.promise).toBeDefined());
    await queue.stop();
    creation.resolve(late);
    await vi.waitFor(() => expect(late.stop).toHaveBeenCalledTimes(1));
    expect(queue.state).toMatchObject({ items: [], status: "idle" });
    expect(late.requests).toHaveLength(0);
  });

  it("unregisters a destroyed binding even when cleanup rejects", async () => {
    const source = new FakeSource("source");
    const player = new FakePlayer();
    player.stop.mockRejectedValue(new Error("cleanup failed"));
    const adapter: Adapter = { createPlayer: vi.fn(async () => player) };
    const distube = new DisTube({ adapter, plugins: [source] });
    const first = distube.createQueue({ guildId: "guild", channelId: "voice" });
    const [item] = await first.enqueue(media("source"));
    await vi.waitFor(() => expect(first.state.current).toBe(item));
    await expect(distube.destroyQueue(first.id)).rejects.toMatchObject({ code: ErrorCode.VOICE_FAILED });
    expect(distube.getQueue(first.id)).toBeUndefined();
    const second = distube.createQueue({ guildId: "guild", channelId: "voice" });
    expect(second.id).not.toBe(first.id);
  });

  it("reports post-terminal disposal failure diagnostically without rewriting item history", async () => {
    const source = new FakeSource("source");
    const dispose = vi.fn(async () => {
      throw new Error("dispose failed");
    });
    source.preparePlayback.mockResolvedValue({
      kind: "resource",
      resource: { kind: "url", url: "https://stream.example/disposal", dispose },
    });
    const player = new FakePlayer();
    const { diagnostics, distube, queue } = setup([source], async () => player);
    const finished = vi.fn();
    const failed = vi.fn();
    distube.on("queue.item.finished", finished);
    distube.on("queue.item.failed", failed);
    const [item] = await queue.enqueue(media("source"));
    await vi.waitFor(() => expect(queue.state.current).toBe(item));
    player.emit({ type: "finished", itemId: item?.id ?? "missing" });
    await vi.waitFor(() => expect(diagnostics).toHaveBeenCalled());
    expect(finished).toHaveBeenCalledTimes(1);
    expect(failed).not.toHaveBeenCalled();
    expect(dispose).toHaveBeenCalledTimes(1);
  });
});
