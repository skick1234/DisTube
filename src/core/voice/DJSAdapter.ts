import { Constants } from "discord.js";
import type { Client, Snowflake, VoiceChannel } from "discord.js";
import type { DiscordGatewayAdapterCreator, DiscordGatewayAdapterLibraryMethods } from "@discordjs/voice";
import type { GatewayVoiceServerUpdateDispatchData, GatewayVoiceStateUpdateDispatchData } from "discord-api-types/v9";

const adapters = new Map<Snowflake, DiscordGatewayAdapterLibraryMethods>();
const trackedClients = new Set<Client>();

function trackClient(client: Client) {
  if (trackedClients.has(client)) return;
  trackedClients.add(client);
  client.ws.on(Constants.WSEvents.VOICE_SERVER_UPDATE, (payload: GatewayVoiceServerUpdateDispatchData) => {
    adapters.get(payload.guild_id)?.onVoiceServerUpdate(payload);
  });
  client.ws.on(Constants.WSEvents.VOICE_STATE_UPDATE, (payload: GatewayVoiceStateUpdateDispatchData) => {
    if (payload.guild_id && payload.session_id && payload.user_id === client.user?.id) {
      adapters.get(payload.guild_id)?.onVoiceStateUpdate(payload);
    }
  });
  client.on(Constants.Events.SHARD_DISCONNECT, (_, shardID) => {
    const guilds = trackedShards.get(shardID);
    if (guilds) {
      for (const guildID of guilds.values()) {
        adapters.get(guildID)?.destroy();
      }
    }
    trackedShards.delete(shardID);
  });
}

const trackedShards = new Map<number, Set<Snowflake>>();

function trackGuild(guild: any) {
  let guilds = trackedShards.get(guild.shardID);
  if (!guilds) {
    guilds = new Set();
    trackedShards.set(guild.shardID, guilds);
  }
  guilds.add(guild.id);
}

export function createDiscordJSAdapter(channel: VoiceChannel): DiscordGatewayAdapterCreator {
  return methods => {
    adapters.set(channel.guild.id, methods);
    trackClient(channel.client);
    trackGuild(channel.guild);
    return {
      sendPayload(data) {
        if (channel.guild.shard.status === Constants.Status.READY) {
          channel.guild.shard.send(data);
          return true;
        }
        return false;
      },
      destroy() {
        return adapters.delete(channel.guild.id);
      },
    };
  };
}
