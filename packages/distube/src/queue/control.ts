import { QueueStatus } from "../enums";
import { DisTubeError } from "../errors";
import type { ActivePlayback } from "./protocol";
import type { QueueState } from "./state";

export type QueueControl = "pause" | "resume" | "seek";

export type ControlDecision =
  | Readonly<{ kind: "noop" }>
  | Readonly<{ kind: "invoke"; control: QueueControl; seconds?: number }>;

export function decideControl(
  state: QueueState,
  active: ActivePlayback | undefined,
  control: QueueControl,
  seconds?: number,
): ControlDecision {
  if (!active || state.current?.id !== active.item.id) {
    throw new DisTubeError("INVALID_STATE", "Queue has no current QueueItem");
  }
  if (control === "pause" && state.status === QueueStatus.Paused) return { kind: "noop" };
  if (control === "resume" && state.status === QueueStatus.Playing) return { kind: "noop" };
  if (control === "seek" && (!Number.isFinite(seconds) || (seconds ?? -1) < 0)) {
    throw new DisTubeError("INVALID_ARGUMENT", "Seek seconds must be non-negative");
  }
  if (control === "seek" && active.item.song.duration === undefined) {
    throw new DisTubeError("UNSUPPORTED", "Cannot seek media with unknown duration");
  }
  return { kind: "invoke", control, ...(seconds === undefined ? {} : { seconds }) };
}
