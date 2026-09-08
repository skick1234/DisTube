import { describe, expect, it } from "vitest";

type ModelAction =
  | "resolve-a"
  | "resolve-b"
  | "select"
  | "prepare"
  | "start"
  | "remove"
  | "pause"
  | "resume"
  | "seek"
  | "skip"
  | "finish"
  | "failure"
  | "cleanup"
  | "stop"
  | "destroy"
  | "shutdown";

interface ModelState {
  readonly waiting: readonly string[];
  readonly current?: string;
  readonly selected?: string;
  readonly status: "idle" | "playing" | "paused";
  readonly terminal: boolean;
  readonly aborted: readonly string[];
  readonly events: readonly string[];
  readonly disposals: Readonly<Record<string, number>>;
}

const initial: ModelState = Object.freeze({
  waiting: Object.freeze([]),
  status: "idle",
  terminal: false,
  aborted: Object.freeze([]),
  events: Object.freeze([]),
  disposals: Object.freeze({}),
});

function apply(state: ModelState, action: ModelAction): ModelState {
  const waiting = [...state.waiting];
  const aborted = [...state.aborted];
  const events = [...state.events];
  const disposals = { ...state.disposals };
  let current = state.current;
  let selected = state.selected;
  let status = state.status;
  let terminal = state.terminal;
  const dispose = (id: string | undefined) => {
    if (id) disposals[id] = Math.min(1, (disposals[id] ?? 0) + 1);
  };

  if (terminal && !["cleanup", "destroy", "shutdown"].includes(action)) return state;
  switch (action) {
    case "resolve-a":
    case "resolve-b": {
      const id = action.at(-1) as string;
      if (!waiting.includes(id) && current !== id) {
        waiting.push(id);
        events.push(`added:${id}`);
      }
      break;
    }
    case "select":
      selected ??= current ? undefined : waiting[0];
      break;
    case "prepare":
      break;
    case "start":
      if (selected && waiting[0] === selected) {
        current = waiting.shift();
        status = "playing";
        events.push(`started:${current}`);
        selected = undefined;
      }
      break;
    case "remove":
      if (selected) {
        waiting.splice(waiting.indexOf(selected), 1);
        aborted.push(selected);
        dispose(selected);
        selected = undefined;
      }
      break;
    case "pause":
      if (current) status = "paused";
      break;
    case "resume":
      if (current) status = "playing";
      break;
    case "seek":
      break;
    case "skip":
    case "finish":
    case "failure":
      if (current) {
        events.push(`${action === "failure" ? "failed" : "finished"}:${current}`);
        dispose(current);
        current = undefined;
        status = "idle";
      }
      break;
    case "cleanup":
      dispose(current ?? selected);
      break;
    case "stop":
      if (selected) aborted.push(selected);
      dispose(current);
      dispose(selected);
      waiting.length = 0;
      current = undefined;
      selected = undefined;
      status = "idle";
      break;
    case "destroy":
    case "shutdown":
      if (selected) aborted.push(selected);
      dispose(current);
      dispose(selected);
      waiting.length = 0;
      current = undefined;
      selected = undefined;
      status = "idle";
      terminal = true;
      break;
  }
  return Object.freeze({
    waiting: Object.freeze(waiting),
    ...(current ? { current } : {}),
    ...(selected ? { selected } : {}),
    status,
    terminal,
    aborted: Object.freeze(aborted),
    events: Object.freeze(events),
    disposals: Object.freeze(disposals),
  });
}

function permutations<Value>(values: readonly Value[]): readonly (readonly Value[])[] {
  if (values.length < 2) return [values];
  return values.flatMap((value, index) =>
    permutations(values.toSpliced(index, 1)).map(rest => Object.freeze([value, ...rest])),
  );
}

function permutationCases(values: readonly ModelAction[]): readonly (readonly [readonly ModelAction[]])[] {
  return permutations(values).map(actions => [actions] as const);
}

describe("reference DisTubeGuild decision model", () => {
  it.each(permutationCases(["resolve-a", "resolve-b", "stop"]))(
    "keeps terminal stop authoritative for enqueue ordering: %j",
    actions => {
      const state = actions.reduce(apply, initial);
      expect(state.current).toBeUndefined();
      expect(state.status).toBe("idle");
      const added = state.events.filter(event => event.startsWith("added:"));
      expect(new Set(added).size).toBe(added.length);
    },
  );

  it.each(permutationCases(["select", "prepare", "remove", "start"]))(
    "fences selected removal against preparation/start: %j",
    actions => {
      const seeded = apply(initial, "resolve-a");
      const state = actions.reduce(apply, seeded);
      expect(state.events.filter(event => event === "started:a")).toHaveLength(state.current === "a" ? 1 : 0);
      expect(state.disposals.a ?? 0).toBeLessThanOrEqual(1);
    },
  );

  it.each(["skip", "finish", "failure"] as const)("terminalizes active playback exactly once for %s", action => {
    const setup: readonly ModelAction[] = ["resolve-a", "select", "prepare", "start"];
    const actions: readonly ModelAction[] = [action, "cleanup", action];
    const started = setup.reduce(apply, initial);
    const state = actions.reduce(apply, started);
    expect(state.current).toBeUndefined();
    expect(state.disposals.a).toBe(1);
    expect(state.events.filter(event => /^(?:finished|failed):a$/u.test(event))).toHaveLength(1);
  });

  it.each(permutationCases(["pause", "resume", "seek", "stop"]))(
    "serializes controls with terminal stop: %j",
    actions => {
      const setup: readonly ModelAction[] = ["resolve-a", "select", "start"];
      const started = setup.reduce(apply, initial);
      const state = actions.reduce(apply, started);
      expect(state.current).toBeUndefined();
      expect(state.status).toBe("idle");
    },
  );

  it.each(["destroy", "shutdown"] as const)("makes %s terminal across late work and repeated cleanup", terminal => {
    const setup: readonly ModelAction[] = ["resolve-a", "select", "prepare"];
    const actions: readonly ModelAction[] = [terminal, "start", "failure", "cleanup", terminal];
    const selected = setup.reduce(apply, initial);
    const state = actions.reduce(apply, selected);
    expect(state.terminal).toBe(true);
    expect(state.current).toBeUndefined();
    expect(state.events).not.toContain("started:a");
    expect(state.disposals.a).toBe(1);
  });
});
