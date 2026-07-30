import type { Client } from "discord.js";
import * as discordjsExports from "../src";

declare const client: Client;

new discordjsExports.DiscordJSAdapter(client, { connectionTimeoutMs: 10_000 });
// @ts-expect-error public Player factories are not configurable
new discordjsExports.DiscordJSAdapter(client, { playerFactory: async () => Promise.reject(new Error("unused")) });
// @ts-expect-error redundant create-adapter aliases are removed
discordjsExports.createDiscordJSAdapter;
