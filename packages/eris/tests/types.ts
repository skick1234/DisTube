import type { Adapter, Player, PlayerEvent } from "distube";
import type { Client } from "eris";
import * as erisExports from "../src";

declare const client: Client;

const options: erisExports.ErisAdapterOptions = { connectionTimeoutMs: 10_000, selfDeaf: true, selfMute: false };
const adapter: Adapter = new erisExports.ErisAdapter(client, options);
// @ts-expect-error public Player factories are not configurable
new erisExports.ErisAdapter(client, { playerFactory: async () => Promise.reject(new Error("unused")) });
// @ts-expect-error redundant create-adapter aliases are removed
erisExports.createErisAdapter;
const playerPromise: Promise<Player> = adapter.createPlayer({ queueId: "queue", guildId: "guild", channelId: "voice" });
const terminal: PlayerEvent = { type: "finished", itemId: "item" };

void playerPromise;
void terminal;
