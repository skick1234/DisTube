import type { VoiceSession } from "distube/integrations";
import type { Client } from "oceanic.js";
import * as oceanicExports from "../src";

declare const client: Client;

const adapter = new oceanicExports.OceanicAdapter(client);
const sessionPromise: Promise<VoiceSession> = adapter.createVoiceSession(
  { guildId: "guild", channelId: "voice" },
  { selfDeaf: true, selfMute: false, timeoutMs: 15_000 },
);
declare const session: VoiceSession;
const clientUserId: string = session.clientUserId;

void [adapter, sessionPromise, clientUserId];
// @ts-expect-error the adapter is constructed from its client alone
new oceanicExports.OceanicAdapter(client, {});
// @ts-expect-error redundant create-adapter aliases are removed
oceanicExports.createOceanicAdapter;
