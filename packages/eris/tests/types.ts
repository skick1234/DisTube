import type { Adapter, Player, PlayerEvent } from "distube";
import type { Client } from "eris";
import { createErisAdapter, ErisAdapter, type ErisAdapterOptions } from "../src";

declare const client: Client;

const options: ErisAdapterOptions = { connectionTimeoutMs: 10_000, selfDeaf: true, selfMute: false };
const adapter: Adapter = new ErisAdapter(client, options);
const factoryAdapter: Adapter = createErisAdapter(client, options);
const playerPromise: Promise<Player> = adapter.createPlayer({ queueId: "queue", guildId: "guild", channelId: "voice" });
const terminal: PlayerEvent = { type: "finished", itemId: "item" };

void factoryAdapter;
void playerPromise;
void terminal;
