import type { VoiceSession } from "distube/integrations";
import type { Client } from "oceanic.js";
import * as oceanicExports from "../src";

declare const client: Client;

const adapter = new oceanicExports.OceanicAdapter(client, { connectionTimeoutMs: 10_000 });
const sessionPromise: Promise<VoiceSession> = adapter.createVoiceSession({ guildId: "guild", channelId: "voice" });
declare const session: VoiceSession;
const clientUserId: string = session.clientUserId;

void [adapter, sessionPromise, clientUserId];
// @ts-expect-error public Player factories are not configurable
new oceanicExports.OceanicAdapter(client, { playerFactory: async () => Promise.reject(new Error("unused")) });
// @ts-expect-error redundant create-adapter aliases are removed
oceanicExports.createOceanicAdapter;
