import { describe, expect, it } from "vitest";
import type { DisTubeEventName } from "../src";
import { type FakePlayer, GUILD, playableSetup, settle, VOICE_CHANNEL } from "./support/harness";

const TARGET = { guildId: GUILD, id: VOICE_CHANNEL };

/**
 * A reference decision model for the layered owners.
 *
 * The model queue is a scheduler over a model voice: it holds current, upcoming, history and status and
 * asks the voice to play or end a track. The real DisTubeQueue must produce the same observable state and
 * the same event order for the same operation sequence.
 */

type ModelOperation =
  | Readonly<{ kind: "add"; id: string }>
  | Readonly<{ kind: "finish" }>
  | Readonly<{ kind: "skip" }>
  | Readonly<{ kind: "remove"; position: number }>
  | Readonly<{ kind: "previous" }>
  | Readonly<{ kind: "jump"; position: number }>
  | Readonly<{ kind: "stop" }>;

interface Snapshot {
  readonly current: string | undefined;
  readonly upcoming: readonly string[];
  readonly history: readonly string[];
  readonly status: "idle" | "playing" | "paused";
}

const OBSERVED: readonly DisTubeEventName[] = [
  "queue.item.added",
  "queue.item.started",
  "queue.item.finished",
  "queue.history.added",
  "queue.finished",
  "queue.deleted",
];

class ModelVoice {
  playing?: string;

  play(id: string): void {
    this.playing = id;
  }

  endTrack(): void {
    this.playing = undefined;
  }
}

class ModelQueue {
  current?: string;
  upcoming: string[] = [];
  history: string[] = [];
  deleted = false;
  readonly events: string[] = [];
  readonly #voice: ModelVoice;

  constructor(voice: ModelVoice) {
    this.#voice = voice;
  }

  get status(): Snapshot["status"] {
    return this.current ? "playing" : "idle";
  }

  snapshot(): Snapshot {
    return { current: this.current, upcoming: [...this.upcoming], history: [...this.history], status: this.status };
  }

  apply(operation: ModelOperation): void {
    if (this.deleted) return;
    switch (operation.kind) {
      case "add":
        this.upcoming.push(operation.id);
        this.events.push("queue.item.added");
        this.#start();
        return;
      case "finish":
        if (!this.current) return;
        this.#end(this.current);
        this.#remember(this.current);
        this.current = undefined;
        this.#start();
        return;
      case "skip":
        if (!this.current) return;
        this.#end(this.current);
        this.#remember(this.current);
        this.current = undefined;
        this.#start();
        return;
      case "remove":
        this.upcoming.splice(operation.position - 1, 1);
        return;
      case "previous": {
        const replay = this.history.pop() as string;
        this.#voice.endTrack();
        this.upcoming.unshift(...(this.current ? [replay, this.current] : [replay]));
        this.current = undefined;
        this.#start();
        return;
      }
      case "jump": {
        // The ended current item and the items before the target enter history without a finished event.
        this.#voice.endTrack();
        const skipped = [...(this.current ? [this.current] : []), ...this.upcoming.splice(0, operation.position - 1)];
        this.current = undefined;
        for (const id of skipped) this.#remember(id);
        this.#start();
        return;
      }
      case "stop":
        this.#voice.endTrack();
        this.#delete();
        return;
    }
  }

  #start(): void {
    if (this.current) return;
    const next = this.upcoming.shift();
    if (!next) {
      this.events.push("queue.finished");
      this.#delete();
      return;
    }
    this.current = next;
    this.#voice.play(next);
    this.events.push("queue.item.started");
  }

  #end(id: string): void {
    this.#voice.endTrack();
    this.events.push("queue.item.finished");
    void id;
  }

  #remember(id: string): void {
    this.history.push(id);
    this.events.push("queue.history.added");
  }

  #delete(): void {
    this.deleted = true;
    this.current = undefined;
    this.upcoming = [];
    this.history = [];
    this.events.push("queue.deleted");
  }
}

/** Songs are addressed by id; `previous` and repeat create new occurrences of the same Song. */
function realSnapshot(
  queue: Readonly<{
    current?: { song: { id: string } };
    upcoming: readonly { song: { id: string } }[];
    history: readonly { song: { id: string } }[];
    status: Snapshot["status"];
  }>,
): Snapshot {
  return {
    current: queue.current?.song.id,
    upcoming: queue.upcoming.map(item => item.song.id),
    history: queue.history.map(item => item.song.id),
    status: queue.status,
  };
}

/** Runs one sequence against a fresh client, comparing state after every step and the event order at the end. */
async function check(sequence: readonly ModelOperation[]): Promise<void> {
  const harness = playableSetup();
  const disposals: number[] = [];
  harness.source.stream.mockImplementation(async song => {
    const index = disposals.push(0) - 1;
    return {
      kind: "resource",
      resource: {
        kind: "url",
        url: `https://stream.example/${song.id}`,
        dispose: () => {
          disposals[index] = (disposals[index] ?? 0) + 1;
          harness.source.disposed.push(song.id);
        },
      },
    };
  });
  const events: string[] = [];
  for (const name of OBSERVED) harness.distube.on(name, () => events.push(name));
  const voice = new ModelVoice();
  const model = new ModelQueue(voice);
  const first = sequence[0];
  if (first?.kind !== "add") throw new Error("A sequence starts with add");

  const queue = await harness.distube.play(TARGET, first.id);
  model.apply(first);
  await settle();
  const player = harness.engine.players[0] as FakePlayer;
  expect(realSnapshot(queue)).toEqual(model.snapshot());

  for (const operation of sequence.slice(1)) {
    switch (operation.kind) {
      case "add":
        await queue.add(operation.id);
        break;
      case "finish":
        player.finish();
        break;
      case "skip":
        await queue.skip();
        break;
      case "remove":
        await queue.remove(operation.position);
        break;
      case "previous":
        await queue.previous();
        break;
      case "jump":
        await queue.jump(operation.position);
        break;
      case "stop":
        await queue.stop();
        break;
    }
    model.apply(operation);
    await settle();
    expect(realSnapshot(queue), `after ${JSON.stringify(operation)} in ${JSON.stringify(sequence)}`).toEqual(
      model.snapshot(),
    );
    expect(player.playing).toBe(voice.playing === undefined ? undefined : queue.current?.id);
    expect(disposals.every(count => count <= 1)).toBe(true);
  }

  expect(harness.distube.getQueue(GUILD)).toBeUndefined();
  expect(events, JSON.stringify(sequence)).toEqual(model.events);
  await harness.distube.dispose();
  expect(disposals).toEqual(disposals.map(() => 1));
  expect([...harness.source.disposed].toSorted()).toEqual(
    harness.source.stream.mock.calls.map(([song]) => song.id).toSorted(),
  );
}

/** A small deterministic PRNG so a failing sequence reproduces from its seed. */
function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

/** Generates an operation sequence that only asks for what the model state allows, ending at deletion. */
function generate(seed: number, length: number): ModelOperation[] {
  const next = random(seed);
  const pick = <Value>(values: readonly Value[]): Value => values[Math.floor(next() * values.length)] as Value;
  const model = new ModelQueue(new ModelVoice());
  const sequence: ModelOperation[] = [];
  let ids = 0;
  const push = (operation: ModelOperation): void => {
    sequence.push(operation);
    model.apply(operation);
  };
  push({ kind: "add", id: `s${ids++}` });
  while (sequence.length < length && !model.deleted) {
    const choices: ModelOperation[] = [{ kind: "add", id: `s${ids}` }];
    if (model.current) choices.push({ kind: "finish" }, { kind: "skip" });
    if (model.upcoming.length > 0) {
      choices.push({ kind: "remove", position: 1 + Math.floor(next() * model.upcoming.length) });
      choices.push({ kind: "jump", position: 1 + Math.floor(next() * model.upcoming.length) });
    }
    if (model.history.length > 0) choices.push({ kind: "previous" });
    if (sequence.length > 2) choices.push({ kind: "stop" });
    const operation = pick(choices);
    if (operation.kind === "add") ids += 1;
    push(operation);
  }
  if (!model.deleted) push({ kind: "stop" });
  return sequence;
}

describe("reference scheduler model", () => {
  it("matches the model over a fixed operation sequence", async () => {
    await check([
      { kind: "add", id: "a" },
      { kind: "add", id: "b" },
      { kind: "add", id: "c" },
      { kind: "add", id: "d" },
      { kind: "finish" },
      { kind: "skip" },
      { kind: "remove", position: 1 },
      { kind: "previous" },
      { kind: "jump", position: 1 },
      { kind: "finish" },
    ]);
  });

  it("matches the model over generated sequences of adds, finishes, skips, edits, jumps, previous and stop", async () => {
    for (let seed = 1; seed <= 40; seed += 1) await check(generate(seed, 12));
  });
});
