import { URL } from "url";
import { DisTubeError } from ".";
import {
  BitFieldResolvable,
  ClientOptions,
  GuildMember,
  Intents,
  IntentsString,
  Message,
  Snowflake,
  SnowflakeUtil,
  StageChannel,
  TextChannel,
  VoiceChannel,
  VoiceState,
} from "discord.js";

const formatInt = (int: number) => (int < 10 ? `0${int}` : int);

/**
 * Format duration to string
 * @param {number} sec Duration in seconds
 * @returns {string}
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
/**
 * Convert formatted duration to seconds
 * @param {*} input Formatted duration string
 * @returns {number}
 */
export function toSecond(input: any): number {
  if (!input) return 0;
  if (typeof input !== "string") return Number(input) || 0;
  let h = 0,
    m = 0,
    s = 0;
  if (input.match(/:/g)) {
    const time = input.split(":");
    if (time.length === 2) {
      m = parseInt(time[0], 10);
      s = parseInt(time[1], 10);
    } else if (time.length === 3) {
      h = parseInt(time[0], 10);
      m = parseInt(time[1], 10);
      s = parseInt(time[2], 10);
    }
  } else {
    s = parseInt(input, 10);
  }
  return h * 60 * 60 + m * 60 + s;
}
/**
 * Parse number from input
 * @param {*} input Any
 * @returns {number}
 */
export function parseNumber(input: any): number {
  if (typeof input === "string") return Number(input.replace(/\D+/g, "")) || 0;
  return Number(input) || 0;
}
/**
 * Check if the string is an URL
 * @param {string} input input
 * @returns {boolean}
 */
export function isURL(input: any): boolean {
  if (typeof input !== "string" || input.includes(" ")) return false;
  try {
    const url = new URL(input);
    if (!["https:", "http:"].includes(url.protocol) || url.origin === "null" || !url.host) return false;
  } catch {
    return false;
  }
  return true;
}
/**
 * Check if the Client has enough intents to using DisTube
 * @param {ClientOptions} options options
 */
export function checkIntents(options: ClientOptions): void {
  const requiredIntents: BitFieldResolvable<IntentsString, number>[] = ["GUILD_VOICE_STATES"];
  const bitfield: BitFieldResolvable<IntentsString, number> = options.intents || (options?.ws as any)?.intents;
  if (typeof bitfield === "undefined") return;
  const intents = new Intents(bitfield);
  for (const intent of requiredIntents) {
    if (!intents.has(intent)) throw new DisTubeError("MISSING_INTENTS", intent);
  }
}

/**
 * Check if the voice channel is empty
 * @param {Discord.VoiceState} voiceState voiceState
 * @returns {boolean}
 */
export function isVoiceChannelEmpty(voiceState: VoiceState): boolean {
  const voiceChannel = voiceState.guild?.me?.voice?.channel;
  if (!voiceChannel) return false;
  const members = voiceChannel.members.filter(m => !m.user.bot);
  return !members.size;
}

export function isSnowflake(id: any): id is Snowflake {
  try {
    return SnowflakeUtil.deconstruct(id).timestamp > SnowflakeUtil.EPOCH;
  } catch {
    return false;
  }
}

export function isMemberInstance(member: any): member is GuildMember {
  return (
    !!member &&
    isSnowflake(member.id) &&
    isSnowflake(member.guild?.id) &&
    isSnowflake(member.user?.id) &&
    member.id === member.user.id
  );
}

export function isTextChannelInstance(channel: any): channel is TextChannel {
  return (
    !!channel &&
    isSnowflake(channel.id) &&
    isSnowflake(channel.guild?.id) &&
    typeof channel.send === "function" &&
    typeof channel.awaitMessages === "function"
  );
}

export function isMessageInstance(message: any): message is Message {
  // Simple check for using distube normally
  return (
    !!message &&
    isSnowflake(message.id) &&
    isSnowflake(message.guild?.id) &&
    isTextChannelInstance(message.channel) &&
    isMemberInstance(message.member) &&
    isSnowflake(message.author?.id) &&
    message.member.id === message.author.id &&
    message.guild.id === message.channel.guild.id
  );
}

export function isSupportedVoiceChannel(channel: any): channel is VoiceChannel | StageChannel {
  return (
    !!channel &&
    channel.deleted === false &&
    isSnowflake(channel.id) &&
    isSnowflake(channel.guild?.id) &&
    typeof channel.full === "boolean" &&
    [
      // Djs v12
      "voice",
      "stage",
      // Djs v13
      "GUILD_VOICE",
      "GUILD_STAGE_VOICE",
    ].includes(channel.type)
  );
}
