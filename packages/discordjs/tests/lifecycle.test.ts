import type { Client } from "discord.js";
import { vi } from "vitest";
import { type AdapterLifecycleBridge, adapterLifecycleSuite } from "../../voice-core/tests/support/adapter-lifecycle";
import { latest } from "../../voice-core/tests/support/native";
import { DiscordJSAdapter } from "../src";

vi.mock("@discordjs/voice", async () => (await import("../../voice-core/tests/support/native")).voiceModule());
vi.mock("node:child_process", async () => (await import("../../voice-core/tests/support/native")).childProcessModule());

const GUILD = "guild";
const adapterCreator = () => ({});

adapterLifecycleSuite("DiscordJSAdapter", (): AdapterLifecycleBridge => {
  const client = {
    guilds: { cache: new Map([[GUILD, { voiceAdapterCreator: adapterCreator }]]) },
  } as unknown as Client;
  const adapter = new DiscordJSAdapter(client);
  return {
    createVoiceSession: target => adapter.createVoiceSession(target),
    connection: () => latest.connection,
  };
});
