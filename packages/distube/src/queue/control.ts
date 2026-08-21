import { QueueStatus } from "../enums";
import { DisTubeError, ErrorCode } from "../errors";
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
    throw new DisTubeError(ErrorCode.INVALID_ARGUMENT, "Queue has no current QueueItem");
  }
  if (control === "pause" && state.status === QueueStatus.Paused) return { kind: "noop" };
  if (control === "resume" && state.status === QueueStatus.Playing) return { kind: "noop" };
  if (control === "seek" && (!Number.isFinite(seconds) || (seconds ?? -1) < 0)) {
    throw new DisTubeError(ErrorCode.INVALID_ARGUMENT, "Seek seconds must be non-negative");
  }
  return { kind: "invoke", control, ...(seconds === undefined ? {} : { seconds }) };
}
