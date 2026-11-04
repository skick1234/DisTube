import { Client, Guild } from "oceanic.js";
import { describe, expect, it } from "vitest";
import { REAL_CHANNEL, REAL_GUILD } from "../../voice-core/tests/support/real";
import { OceanicAdapter } from "../src";

describe("real oceanic.js", () => {
  it("exposes voiceAdapterCreator on a real Oceanic Guild and refuses an absent guild", async () => {
    // oceanic.js builds a Guild only from a live gateway payload, so the getter is checked on the prototype.
    expect(typeof Object.getOwnPropertyDescriptor(Guild.prototype, "voiceAdapterCreator")?.get).toBe("function");

    const client = new Client({ auth: "Bot invalid" });
    await new OceanicAdapter(client)
      .createVoiceSession(
        { guildId: REAL_GUILD, channelId: REAL_CHANNEL },
        { selfDeaf: true, selfMute: false, timeoutMs: 50 },
      )
      .then(
        () => expect.unreachable("an unknown guild has no voice presence"),
        (error: Error) => expect(error.message).toContain(REAL_GUILD),
      );
  });
});
