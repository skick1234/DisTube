/** Package-private reasons a DisTubeGuild accepts terminal authority. */
export type QueueTerminalCause =
  | Readonly<{ kind: "stop" }>
  | Readonly<{ kind: "finished" }>
  | Readonly<{ kind: "leave" }>
  | Readonly<{ kind: "shutdown" }>
  | Readonly<{ kind: "rollback" }>
  | Readonly<{ kind: "voice-loss"; error?: Error }>;
