import { Client, ClientUser, Guild, Message, VoiceState } from "discord.js";
import { rawBotVoiceState, rawClientUser, rawGuild, rawMessage, rawUserVoiceState } from "./raw";
import {
  DisTubeError,
  DisTubeVoice as _Voice,
  checkIntents,
  checkInvalidKey,
  formatDuration,
  isClientInstance,
  isMemberInstance,
  isMessageInstance,
  isSupportedVoiceChannel,
  isTextChannelInstance,
  isURL,
  isVoiceChannelEmpty,
  parseNumber,
  resolveGuildId,
  toSecond,
} from "..";

jest.mock("../core/voice/DisTubeVoice");

const Voice = _Voice as unknown as jest.Mocked<typeof _Voice>;

const client = new Client({ intents: [] });
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
client.user = new ClientUser(client, rawClientUser);
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
const guild = new Guild(client, rawGuild);
const textChannel = guild.channels.cache.get("737499503384461325");
const voiceChannel = guild.channels.cache.get("853225781604646933");
Object.defineProperty(voiceChannel, "joinable", { value: true, writable: false });
const stageChannel = guild.channels.cache.get("835876864458489857");
Object.defineProperty(stageChannel, "joinable", { value: false, writable: false });
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
const botVoiceState = new VoiceState(guild, rawBotVoiceState);
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
const userVoiceState = new VoiceState(guild, rawUserVoiceState);
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
const message = new Message(client, rawMessage);

test("isSupportedVoiceChannel()", () => {
  const testFn = isSupportedVoiceChannel;
  expect(testFn(voiceChannel)).toBe(true);
  expect(testFn(stageChannel)).toBe(true);
  expect(testFn(textChannel)).toBe(false);
  expect(testFn(message)).toBe(false);
  expect(testFn(guild)).toBe(false);
  expect(testFn(client)).toBe(false);
  expect(testFn(client.user)).toBe(false);
  expect(testFn(guild.me)).toBe(false);
  expect(testFn(botVoiceState)).toBe(false);
  expect(testFn(userVoiceState)).toBe(false);
});

test("isMessageInstance()", () => {
  const testFn = isMessageInstance;
  expect(testFn(voiceChannel)).toBe(false);
  expect(testFn(stageChannel)).toBe(false);
  expect(testFn(textChannel)).toBe(false);
  expect(testFn(message)).toBe(true);
  expect(testFn(guild)).toBe(false);
  expect(testFn(client)).toBe(false);
  expect(testFn(client.user)).toBe(false);
  expect(testFn(guild.me)).toBe(false);
  expect(testFn(botVoiceState)).toBe(false);
  expect(testFn(userVoiceState)).toBe(false);
});

test("isTextChannelInstance()", () => {
  const testFn = isTextChannelInstance;
  expect(testFn(voiceChannel)).toBe(false);
  expect(testFn(stageChannel)).toBe(false);
  expect(testFn(textChannel)).toBe(true);
  expect(testFn(message)).toBe(false);
  expect(testFn(guild)).toBe(false);
  expect(testFn(client)).toBe(false);
  expect(testFn(client.user)).toBe(false);
  expect(testFn(guild.me)).toBe(false);
  expect(testFn(botVoiceState)).toBe(false);
  expect(testFn(userVoiceState)).toBe(false);
});

test("isMemberInstance()", () => {
  const testFn = isMemberInstance;
  expect(testFn(voiceChannel)).toBe(false);
  expect(testFn(stageChannel)).toBe(false);
  expect(testFn(textChannel)).toBe(false);
  expect(testFn(message)).toBe(false);
  expect(testFn(guild)).toBe(false);
  expect(testFn(client)).toBe(false);
  expect(testFn(client.user)).toBe(false);
  expect(testFn(guild.me)).toBe(true);
  expect(testFn(botVoiceState)).toBe(false);
  expect(testFn(userVoiceState)).toBe(false);
});

test("isVoiceChannelEmpty()", () => {
  expect(isVoiceChannelEmpty(voiceChannel as any)).toBe(false);
  expect(isVoiceChannelEmpty(botVoiceState)).toBe(false);
  guild.voiceStates.cache.set(botVoiceState.id, botVoiceState);
  expect(isVoiceChannelEmpty(botVoiceState)).toBe(true);
  guild.voiceStates.cache.set(userVoiceState.id, userVoiceState);
  expect(isVoiceChannelEmpty(botVoiceState)).toBe(false);
});

test("checkIntents()", () => {
  const intent = "GuildVoiceStates";
  const client1 = new Client({ intents: [] });
  const client2 = new Client({ intents: ["Guilds"] });
  const client3 = new Client({ intents: [intent] });
  expect(() => {
    checkIntents(client1.options);
  }).toThrow(new DisTubeError("MISSING_INTENTS", intent));
  expect(() => {
    checkIntents(client2.options);
  }).toThrow(new DisTubeError("MISSING_INTENTS", intent));
  expect(checkIntents(client3.options)).toBeUndefined();
});

test("isURL()", () => {
  expect(isURL(1)).toBe(false);
  expect(isURL("")).toBe(false);
  expect(isURL("not an url")).toBe(false);
  expect(isURL("https://")).toBe(false);
  expect(isURL("file://abc")).toBe(false);
  expect(isURL("http://localhost:1234")).toBe(true);
  expect(isURL("https://distube.js.org/")).toBe(true);
  expect(isURL("http://distube.js.org:433")).toBe(true);
});

test("parseNumber()", () => {
  expect(parseNumber({})).toBe(0);
  expect(parseNumber(".")).toBe(0);
  expect(parseNumber(123)).toBe(123);
  expect(parseNumber("12,300")).toBe(12300);
});

test("toSecond()", () => {
  expect(toSecond(undefined)).toBe(0);
  expect(toSecond(123)).toBe(123);
  expect(toSecond({})).toBe(0);
  expect(toSecond(".")).toBe(0);
  expect(toSecond("10")).toBe(10);
  expect(toSecond("10,234.5")).toBe(10234.5);
  expect(toSecond("1:10.6")).toBe(70.6);
  expect(toSecond("1:23:45")).toBe(5025);
  expect(toSecond("1:1:23:45")).toBe(91425);
});

test("formatDuration()", () => {
  expect(formatDuration(undefined as any)).toBe("00:00");
  expect(formatDuration(0)).toBe("00:00");
  expect(formatDuration(1)).toBe("00:01");
  expect(formatDuration(70.6)).toBe("01:11");
  expect(formatDuration(5025)).toBe("01:23:45");
  expect(formatDuration(91425)).toBe("25:23:45");
});

test("resolveGuildID()", () => {
  const voice = new Voice({} as any, voiceChannel);
  const gId = "737499502763704370";
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
  voice.id = gId;
  const testFn = resolveGuildId;
  expect(testFn(voice)).toBe(gId);
  expect(testFn(voiceChannel)).toBe(gId);
  expect(testFn(stageChannel)).toBe(gId);
  expect(testFn(textChannel)).toBe(gId);
  expect(testFn(message)).toBe(gId);
  expect(testFn(guild)).toBe(gId);
  expect(testFn(guild.me)).toBe(gId);
  expect(testFn(botVoiceState)).toBe(gId);
  expect(testFn(userVoiceState)).toBe(gId);
  expect(testFn(gId)).toBe(gId);
  expect(() => testFn(client as any)).toThrow(new DisTubeError("INVALID_TYPE", "GuildIdResolvable", client));
  expect(() => testFn(client.user as any)).toThrow(new DisTubeError("INVALID_TYPE", "GuildIdResolvable", client.user));
  expect(() => testFn(1 as any)).toThrow(new DisTubeError("INVALID_TYPE", "GuildIdResolvable", 1));
});

test("isClientInstance()", () => {
  const testFn = isClientInstance;
  expect(testFn(voiceChannel)).toBe(false);
  expect(testFn(stageChannel)).toBe(false);
  expect(testFn(textChannel)).toBe(false);
  expect(testFn(message)).toBe(false);
  expect(testFn(guild)).toBe(false);
  expect(testFn(client)).toBe(true);
  expect(testFn(client.user)).toBe(false);
  expect(testFn(guild.me)).toBe(false);
  expect(testFn(botVoiceState)).toBe(false);
  expect(testFn(userVoiceState)).toBe(false);
});

test("checkInvalidKey()", () => {
  const target = {
    a: 0,
    b: 1,
  };
  const name = "target";
  expect(() => checkInvalidKey(0 as any, [], name)).toThrow(new DisTubeError("INVALID_TYPE", "object", 0, name));
  expect(() => checkInvalidKey(target, ["b"], name)).toThrow(`'a' does not need to be provided in ${name}`);
  expect(() => checkInvalidKey(target, { a: undefined }, name)).toThrow(`'b' does not need to be provided in ${name}`);
  expect(checkInvalidKey(target, { a: 0, b: 0, c: 0 }, name)).toBeUndefined();
  expect(checkInvalidKey(target, ["a", "b"], name)).toBeUndefined();
});
