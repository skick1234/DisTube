import type { Adapter, Player, VoiceSession } from "distube/integrations";
import type { Client } from "eris";
import * as erisExports from "../src";

declare const client: Client;
declare const session: VoiceSession;

const options: erisExports.ErisAdapterOptions = { connectionTimeoutMs: 10_000 };
const adapter = new erisExports.ErisAdapter(client, options);
const contract: Adapter = adapter;
// @ts-expect-error public Player factories are not configurable
new erisExports.ErisAdapter(client, { playerFactory: async () => Promise.reject(new Error("unused")) });
// @ts-expect-error redundant create-adapter aliases are removed
erisExports.createErisAdapter;
const sessionPromise: Promise<VoiceSession> = adapter.createVoiceSession(
  { guildId: "guild", channelId: "voice" },
  { selfDeaf: false, selfMute: true },
);
const playerPromise: Promise<Player> = adapter.engine.createPlayer(session);
const clientUserId: string = session.clientUserId;

void sessionPromise;
void contract;
void playerPromise;
void clientUserId;
