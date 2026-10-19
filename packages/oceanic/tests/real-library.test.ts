import { Client, Guild } from "oceanic.js";
import { describe, expect, it } from "vitest";
import { REAL_CHANNEL, REAL_GUILD } from "../../voice-core/tests/support/real";
import { OceanicAdapter } from "../src";

// Nothing is mocked here: the real oceanic.js Client and Guild. The @discordjs/voice connection and the
// voice-core Player this adapter drives are exercised once, in packages/discordjs/tests/real-library.test.ts.

describe("real oceanic.js", () => {
  it("exposes voiceAdapterCreator on a real Oceanic Guild and refuses an absent guild", async () => {
    // Oceanic builds a Guild only from a live gateway payload, so the getter the adapter reads is checked on
    // the prototype, and the refusal goes through the real client's own guild map.
    expect(typeof Object.getOwnPropertyDescriptor(Guild.prototype, "voiceAdapterCreator")?.get).toBe("function");

    const client = new Client({ auth: "Bot invalid" });
    await new OceanicAdapter(client).createVoiceSession({ guildId: REAL_GUILD, channelId: REAL_CHANNEL }).then(
      () => expect.unreachable("an unknown guild has no voice presence"),
      (error: Error) => expect(error.message).toContain(REAL_GUILD),
    );
  });
});
