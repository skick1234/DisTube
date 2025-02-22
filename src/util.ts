import { URL } from "url";
import { DisTubeError, DisTubeVoice, Queue } from ".";
import { Constants, GatewayIntentBits, IntentsBitField, SnowflakeUtil } from "discord.js";
import type { GuildIdResolvable } from ".";
import type {
  Client,
  ClientOptions,
  Guild,
  GuildMember,
  GuildTextBasedChannel,
  Message,
  Snowflake,
  VoiceBasedChannel,
  VoiceState,
} from "discord.js";

const formatInt = (int: number) => (int < 10 ? `0${int}` : int);

/**
 * Format duration to string
 * @param sec - Duration in seconds
 */
export function formatDuration(sec: number): string {
  if (!sec || !Number(sec)) return "00:00";
  const seconds = Math.floor(sec % 60);
  const minutes = Math.floor((sec % 3600) / 60);
  const hours = Math.floor(sec / 3600);
  if (hours > 0) return `${formatInt(hours)}:${formatInt(minutes)}:${formatInt(seconds)}`;
  if (minutes > 0) return `${formatInt(minutes)}:${formatInt(seconds)}`;
  return `00:${formatInt(seconds)}`;
}
const SUPPORTED_PROTOCOL = ["https:", "http:", "file:"] as const;
/**
 * Check if the string is an URL
 * @param input - input
 */
export function isURL(input: any): input is `${(typeof SUPPORTED_PROTOCOL)[number]}//${string}` {
  if (typeof input !== "string" || input.includes(" ")) return false;
  try {
    const url = new URL(input);
    if (!SUPPORTED_PROTOCOL.some(p => p === url.protocol)) return false;
  } catch {
    return false;
  }
  return true;
}
/**
 * Check if the Client has enough intents to using DisTube
 * @param options - options
 */
export function checkIntents(options: ClientOptions): void {
  const intents = options.intents instanceof IntentsBitField ? options.intents : new IntentsBitField(options.intents);
  if (!intents.has(GatewayIntentBits.GuildVoiceStates)) throw new DisTubeError("MISSING_INTENTS", "GuildVoiceStates");
}

/**
 * Check if the voice channel is empty
 * @param voiceState - voiceState
 */
export function isVoiceChannelEmpty(voiceState: VoiceState): boolean {
  const guild = voiceState.guild;
  const clientId = voiceState.client.user?.id;
  if (!guild || !clientId) return false;
  const voiceChannel = guild.members.me?.voice?.channel;
  if (!voiceChannel) return false;
  const members = voiceChannel.members.filter(m => !m.user.bot);
  return !members.size;
}

export function isSnowflake(id: any): id is Snowflake {
  try {
    return SnowflakeUtil.deconstruct(id).timestamp > SnowflakeUtil.epoch;
  } catch {
    return false;
  }
}

export function isMemberInstance(member: any): member is GuildMember {
  return (
    Boolean(member) &&
    isSnowflake(member.id) &&
    isSnowflake(member.guild?.id) &&
    isSnowflake(member.user?.id) &&
    member.id === member.user.id
  );
}

export function isTextChannelInstance(channel: any): channel is GuildTextBasedChannel {
  return (
    Boolean(channel) &&
    isSnowflake(channel.id) &&
    isSnowflake(channel.guildId || channel.guild?.id) &&
    Constants.TextBasedChannelTypes.includes(channel.type) &&
    typeof channel.send === "function" &&
    (typeof channel.nsfw === "boolean" || typeof channel.parent?.nsfw === "boolean")
  );
}

export function isMessageInstance(message: any): message is Message<true> {
  // Simple check for using distube normally
  return (
    Boolean(message) &&
    isSnowflake(message.id) &&
    isSnowflake(message.guildId || message.guild?.id) &&
    isMemberInstance(message.member) &&
    isTextChannelInstance(message.channel) &&
    Constants.NonSystemMessageTypes.includes(message.type) &&
    message.member.id === message.author?.id
  );
}

export function isSupportedVoiceChannel(channel: any): channel is VoiceBasedChannel {
  return (
    Boolean(channel) &&
    isSnowflake(channel.id) &&
    isSnowflake(channel.guildId || channel.guild?.id) &&
    Constants.VoiceBasedChannelTypes.includes(channel.type)
  );
}

export function isGuildInstance(guild: any): guild is Guild {
  return Boolean(guild) && isSnowflake(guild.id) && isSnowflake(guild.ownerId) && typeof guild.name === "string";
}

export function resolveGuildId(resolvable: GuildIdResolvable): Snowflake {
  let guildId: string | undefined;
  if (typeof resolvable === "string") {
    guildId = resolvable;
  } else if (isObject(resolvable)) {
    if ("guildId" in resolvable && resolvable.guildId) {
      guildId = resolvable.guildId;
    } else if (resolvable instanceof Queue || resolvable instanceof DisTubeVoice || isGuildInstance(resolvable)) {
      guildId = resolvable.id;
    } else if ("guild" in resolvable && isGuildInstance(resolvable.guild)) {
      guildId = resolvable.guild.id;
    }
  }
  if (!isSnowflake(guildId)) throw new DisTubeError("INVALID_TYPE", "GuildIdResolvable", resolvable);
  return guildId;
}

export function isClientInstance(client: any): client is Client {
  return Boolean(client) && typeof client.login === "function";
}

export function checkInvalidKey(
  target: Record<string, any>,
  source: Record<string, any> | string[],
  sourceName: string,
) {
  if (!isObject(target)) throw new DisTubeError("INVALID_TYPE", "object", target, sourceName);
  const sourceKeys = Array.isArray(source) ? source : objectKeys(source);
  const invalidKey = objectKeys(target).find(key => !sourceKeys.includes(key));
  if (invalidKey) throw new DisTubeError("INVALID_KEY", sourceName, invalidKey);
}

export function isObject(obj: any): obj is object {
  return typeof obj === "object" && obj !== null && !Array.isArray(obj);
}

export type KeyOf<T> = T extends object ? (keyof T)[] : [];
export function objectKeys<T>(obj: T): KeyOf<T> {
  if (!isObject(obj)) return [] as KeyOf<T>;
  return Object.keys(obj) as KeyOf<T>;
}

export function isNsfwChannel(channel?: GuildTextBasedChannel): boolean {
  if (!isTextChannelInstance(channel)) return false;
  if (channel.isThread()) return channel.parent?.nsfw ?? false;
  return channel.nsfw;
}

export type Falsy = undefined | null | false | 0 | "";
export const isTruthy = <T>(x: T | Falsy): x is T => Boolean(x);

export const checkEncryptionLibraries = async () => {
  if (await import("node:crypto").then(m => m.getCiphers().includes("aes-256-gcm"))) return true;
  for (const lib of [
    "@noble/ciphers",
    "@stablelib/xchacha20poly1305",
    "sodium-native",
    "sodium",
    "libsodium-wrappers",
    "tweetnacl",
  ]) {
    try {
      await import(lib);
      return true;
    } catch {}
  }
  return false;
};
