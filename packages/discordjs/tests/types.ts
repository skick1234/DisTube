import type { Client } from "discord.js";
import type { VoiceSession } from "distube";
import * as discordjsExports from "../src";

declare const client: Client;

const adapter = new discordjsExports.DiscordJSAdapter(client, { connectionTimeoutMs: 10_000 });
const sessionPromise: Promise<VoiceSession> = adapter.createVoiceSession({ guildId: "guild", channelId: "voice" });
declare const session: VoiceSession;
const clientUserId: string = session.clientUserId;

void [adapter, sessionPromise, clientUserId];
// @ts-expect-error public Player factories are not configurable
new discordjsExports.DiscordJSAdapter(client, { playerFactory: async () => Promise.reject(new Error("unused")) });
// @ts-expect-error redundant create-adapter aliases are removed
discordjsExports.createDiscordJSAdapter;
