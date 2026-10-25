import type { Client } from "discord.js";
import type { VoiceSession } from "distube/integrations";
import * as discordjsExports from "../src";

declare const client: Client;

const adapter = new discordjsExports.DiscordJSAdapter(client);
const sessionPromise: Promise<VoiceSession> = adapter.createVoiceSession(
  { guildId: "guild", channelId: "voice" },
  { selfDeaf: true, selfMute: false, timeoutMs: 15_000 },
);
declare const session: VoiceSession;
const clientUserId: string = session.clientUserId;

void [adapter, sessionPromise, clientUserId];
// @ts-expect-error the adapter is constructed from its client alone
new discordjsExports.DiscordJSAdapter(client, {});
