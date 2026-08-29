import type { Adapter, Player, PlayerEvent, VoiceSession } from "distube";
import type { Client } from "eris";
import * as erisExports from "../src";

declare const client: Client;
declare const session: VoiceSession;

const options: erisExports.ErisAdapterOptions = { connectionTimeoutMs: 10_000, selfDeaf: true, selfMute: false };
const adapter: Adapter = new erisExports.ErisAdapter(client, options);
// @ts-expect-error public Player factories are not configurable
new erisExports.ErisAdapter(client, { playerFactory: async () => Promise.reject(new Error("unused")) });
// @ts-expect-error redundant create-adapter aliases are removed
erisExports.createErisAdapter;
const sessionPromise: Promise<VoiceSession> = adapter.createVoiceSession({ guildId: "guild", channelId: "voice" });
const playerPromise: Promise<Player> = adapter.engine.createPlayer(session);
const terminal: PlayerEvent = { type: "failed", itemId: "item", error: new Error("retired"), terminal: true };
const idleTerminal: PlayerEvent = { type: "terminal", error: new Error("backend lost") };
const clientUserId: string = session.clientUserId;

void sessionPromise;
void playerPromise;
void terminal;
void idleTerminal;
void clientUserId;
