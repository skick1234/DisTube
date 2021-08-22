import { rawClientUser } from "./raw";
import {
  CustomPlugin,
  DisTube,
  DisTubeError,
  DisTubeHandler,
  DisTubeVoiceManager,
  ExtractorPlugin,
  Options,
  QueueManager,
  defaultFilters,
} from "..";
import { Client, ClientUser } from "discord.js";

beforeAll(() => {
  jest.resetAllMocks();
});

describe("Constructor", () => {
  test("#1", () => {
    expect(() => new DisTube({} as any)).toThrow(new DisTubeError("INVALID_TYPE", "Discord.Client", {}, "client"));
    const c = new Client({ intents: [] });
    c.user = new ClientUser(c, rawClientUser);
    expect(() => new DisTube(c)).toThrow(new DisTubeError("MISSING_INTENTS", "GUILD_VOICE_STATES"));
  });

  test("#2", () => {
    const client = new Client({ intents: ["GUILD_VOICE_STATES"] });
    client.user = new ClientUser(client, rawClientUser);
    jest.spyOn(client, "on");
    const distube = new DisTube(client, {
      updateYouTubeDL: false,
      plugins: [new ExtractorPlugin(), new CustomPlugin()],
    });
    expect(distube.client).toBe(client);
    expect(distube.voices).toBeInstanceOf(DisTubeVoiceManager);
    expect(distube.options).toBeInstanceOf(Options);
    expect(distube.handler).toBeInstanceOf(DisTubeHandler);
    expect(distube.queues).toBeInstanceOf(QueueManager);
    expect(distube.filters).toEqual(defaultFilters);
    expect(distube.extractorPlugins.find(p => p.constructor.name === "YouTubeDLPlugin")).toBeTruthy();
    expect(distube.extractorPlugins.find(p => p.type === "custom")).toBeFalsy();
    expect(distube.customPlugins.find(p => p.type === "extractor")).toBeFalsy();
  });

  test("#3", () => {
    const client = new Client({ intents: ["GUILD_VOICE_STATES"] });
    client.user = new ClientUser(client, rawClientUser);
    jest.spyOn(client, "on");
    const distube = new DisTube(client, {
      leaveOnEmpty: false,
      youtubeDL: false,
      updateYouTubeDL: false,
      plugins: [new ExtractorPlugin(), new CustomPlugin()],
    });
    expect(distube.client).toBe(client);
    expect(distube.voices).toBeInstanceOf(DisTubeVoiceManager);
    expect(distube.options).toBeInstanceOf(Options);
    expect(distube.handler).toBeInstanceOf(DisTubeHandler);
    expect(distube.queues).toBeInstanceOf(QueueManager);
    expect(distube.filters).toEqual(defaultFilters);
    expect(distube.extractorPlugins.find(p => p.constructor.name === "YouTubeDLPlugin")).toBeFalsy();
    expect(distube.extractorPlugins.find(p => p.type === "custom")).toBeFalsy();
    expect(distube.customPlugins.find(p => p.type === "extractor")).toBeFalsy();
    expect(client.on).not.toBeCalled();
  });
});

test.todo("The rest of DisTube's methods");
