import { Client, ClientUser, Guild, Message, StageChannel, TextChannel, VoiceChannel, VoiceState } from "discord.js";
import {
  DisTubeError,
  checkIntents,
  formatDuration,
  isMemberInstance,
  isMessageInstance,
  isSupportedVoiceChannel,
  isTextChannelInstance,
  isURL,
  isVoiceChannelEmpty,
  parseNumber,
  resolveGuildID,
  toSecond,
} from "..";
import { rawBotVoiceState, rawClientUser, rawGuild, rawMessage, rawUserVoiceState } from "./raw";

const client = new Client({ intents: [] });
client.user = new ClientUser(client, rawClientUser);
const guild = new Guild(client, rawGuild);
const textChannel = guild.channels.cache.get("737499503384461325") as TextChannel;
const voiceChannel = guild.channels.cache.get("853225781604646933") as VoiceChannel;
const stageChannel = guild.channels.cache.get("835876864458489857") as StageChannel;
const botVoiceState = new VoiceState(guild, rawBotVoiceState);
const userVoiceState = new VoiceState(guild, rawUserVoiceState);
const message = new Message(client, rawMessage, textChannel);

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
  const intent = "GUILD_VOICE_STATES";
  const client1 = new Client({ intents: [] });
  const client2 = new Client({ intents: ["GUILDS"] });
  const client3 = new Client({ intents: [intent] });
  expect(() => {
    checkIntents(client1.options);
  }).toThrow(new DisTubeError("MISSING_INTENTS", intent));
  expect(() => {
    checkIntents(client2.options);
  }).toThrow(new DisTubeError("MISSING_INTENTS", intent));
  expect(checkIntents(client3.options)).toBeUndefined();
  // Fake djs v12
  const client4: any = new Client({ intents: [] });
  const client5: any = new Client({ intents: [] });
  const client6: any = new Client({ intents: [] });
  delete client4.options.intents;
  delete client5.options.intents;
  delete client6.options.intents;
  client4.options.ws.intents = undefined;
  client5.options.ws.intents = client2.options.intents;
  client6.options.ws.intents = client3.options.intents;
  expect(checkIntents(client4.options)).toBeUndefined();
  expect(() => {
    checkIntents(client5.options);
  }).toThrow(new DisTubeError("MISSING_INTENTS", intent));
  expect(checkIntents(client6.options)).toBeUndefined();
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
  const gID = "737499502763704370";
  const testFn = resolveGuildID;
  expect(testFn(voiceChannel)).toBe(gID);
  expect(testFn(stageChannel)).toBe(gID);
  expect(testFn(textChannel)).toBe(gID);
  expect(testFn(message)).toBe(gID);
  expect(testFn(guild)).toBe(gID);
  expect(testFn(guild.me)).toBe(gID);
  expect(testFn(botVoiceState)).toBe(gID);
  expect(testFn(userVoiceState)).toBe(gID);
  expect(testFn(gID)).toBe(gID);
  expect(() => testFn(client as any)).toThrow(new DisTubeError("INVALID_TYPE", "GuildIDResolvable", client));
  expect(() => testFn(client.user as any)).toThrow(new DisTubeError("INVALID_TYPE", "GuildIDResolvable", client.user));
});
