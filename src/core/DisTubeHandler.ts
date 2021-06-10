import ytdl from "ytdl-core";
import ytpl from "@distube/ytpl";
import { Song, SearchResult, Playlist, Queue } from "../struct";
import DisTubeBase from "./DisTubeBase";
import Discord from "discord.js";
import DisTubeStream from "./DisTubeStream";
import DisTube from "../DisTube";
import { OtherSongInfo } from "../types";
import { isURL } from "../Util";
import { Readable } from "stream";
import { AudioPlayerStatus, createAudioPlayer, entersState, joinVoiceChannel, VoiceConnectionStatus, createAudioResource } from "@discordjs/voice";
import { createDiscordJSAdapter } from "./VoiceAdapter";

/**
 * DisTube's Handler
 * @extends DisTubeBase
 * @private
 */
export class DisTubeHandler extends DisTubeBase {
  ytdlOptions: ytdl.downloadOptions;
  constructor(distube: DisTube) {
    super(distube);
    const requestOptions = this.options.youtubeCookie ? { headers: { cookie: this.options.youtubeCookie, "x-youtube-identity-token": this.options.youtubeIdentityToken } } : undefined;
    this.ytdlOptions = Object.assign(this.options.ytdlOptions, { requestOptions });
  }

  /**
   * Emit error event
   * @param {Discord.TextChannel} channel Text channel where the error is encountered.
   * @param {Error} error error
   * @private
   */
  emitError(channel: Discord.TextChannel, error: Error) {
    this.distube.emitError(channel, error);
  }

  /**
   * @param {string} url url
   * @param {boolean} [basic=false] getBasicInfo?
   * @returns {Promise<ytdl.videoInfo>}
   */
  getYouTubeInfo(url: string, basic = false): Promise<ytdl.videoInfo> {
    if (basic) return ytdl.getBasicInfo(url, this.ytdlOptions);
    return ytdl.getInfo(url, this.ytdlOptions);
  }

  /**
   * Resolve a Song
   * @param {Discord.Message|Discord.GuildMember} message A message from guild channel | A guild member
   * @param {string|Song|SearchResult|Playlist} song YouTube url | Search string | {@link Song}
   * @returns {Promise<Song|Song[]|Playlist>} Resolved Song
   */
  async resolveSong(
    message: Discord.Message | Discord.GuildMember,
    song: string | ytdl.videoInfo | Song | Playlist | SearchResult | OtherSongInfo | ytdl.relatedVideo | null,
  ): Promise<Song | Playlist | null> {
    if (!song) return null;
    const member = (message as Discord.Message)?.member || message as Discord.GuildMember;
    if (song instanceof Song || song instanceof Playlist) return song;
    if (song instanceof SearchResult) {
      if (song.type === "video") return new Song(song, member);
      else if (song.type === "playlist") return this.resolvePlaylist(message, song.url);
      throw new Error("Invalid SearchResult");
    }
    if (typeof song === "object") return new Song(song, member);
    if (ytdl.validateURL(song)) return new Song(await this.getYouTubeInfo(song), member);
    if (isURL(song)) {
      for (const plugin of this.distube.extractorPlugins) if (await plugin.validate(song)) return plugin.resolve(song, member);
      throw new Error("Not Supported URL!");
    }
    if (typeof song !== "string") throw new TypeError("song is not a valid type");
    if (message instanceof Discord.GuildMember) song = (await this.distube.search(song, { limit: 1 }))[0];
    else song = await this.searchSong(message, song);
    return this.resolveSong(message, song);
  }

  /**
   * Resole Song[] or url to a Playlist
   * @param {Discord.Message|Discord.GuildMember} message A message from guild channel | A guild member
   * @param {Song[]|string} playlist Resolvable playlist
   * @param {string} [source="youtube"] Playlist source
   * @returns {Promise<Playlist>}
   */
  async resolvePlaylist(
    message: Discord.Message | Discord.GuildMember,
    playlist: Song[] | string,
    source = "youtube",
  ): Promise<Playlist> {
    const member = (message as Discord.Message)?.member || message as Discord.GuildMember;
    let solvablePlaylist: Song[] | ytpl.result;
    if (typeof playlist === "string") {
      solvablePlaylist = await ytpl(playlist, { limit: Infinity });
      (solvablePlaylist as any).items = solvablePlaylist.items
        .filter(v => !v.thumbnail.includes("no_thumbnail"))
        .map(v => new Song(v as OtherSongInfo, member));
    } else solvablePlaylist = playlist;
    if (!(playlist instanceof Playlist)) return new Playlist(solvablePlaylist, member, { source });
    return playlist;
  }

  /**
   * Create a custom playlist
   * @returns {Promise<Playlist>}
   * @param {Discord.Message|Discord.GuildMember} message A message from guild channel | A guild member
   * @param {Array<string|Song|SearchResult>} songs Array of url, Song or SearchResult
   * @param {Object} [properties={}] Additional properties such as `name`
   * @param {boolean} [parallel=true] Whether or not fetch the songs in parallel
   */
  async createCustomPlaylist(
    message: Discord.Message | Discord.GuildMember,
    songs: any[],
    properties: any = {},
    parallel = true,
  ): Promise<Playlist> {
    const member = (message as Discord.Message)?.member || message as Discord.GuildMember;
    if (!Array.isArray(songs)) throw new TypeError("songs must be an array of url");
    if (!songs.length) throw new Error("songs is an empty array");
    songs = songs.filter(song => song instanceof Song || song instanceof SearchResult || isURL(song));
    if (!songs.length) throw new Error("songs does not have any valid Song, SearchResult or url");
    if (parallel) {
      songs = songs.map((song: any) => this.resolveSong(member, song).catch(() => undefined));
      songs = await Promise.all(songs);
    } else {
      const resolved = [];
      for (const song of songs) resolved.push(await this.resolveSong(member, song).catch(() => undefined));
      songs = resolved;
    }
    return new Playlist(songs.filter(Boolean), member, properties);
  }

  /**
   * Play / add a playlist
   * @returns {Promise<void>}
   * @param {Discord.Message|Discord.VoiceChannel|Discord.StageChannel} message A message from guild channel | a voice channel
   * @param {Playlist|string} playlist A YouTube playlist url | a Playlist
   * @param {Discord.TextChannel|boolean} [textChannel] The default text channel of the queue
   * @param {boolean} [skip=false] Skip the playing song (if exists) and play the added playlist instantly
   * @param {boolean} [unshift=false] Add the playlist to the beginning of the queue (after the playing song if exists)
   */
  async handlePlaylist(
    message: Discord.Message | Discord.VoiceChannel | Discord.StageChannel,
    playlist: Playlist,
    textChannel: Discord.TextChannel | boolean = false,
    skip = false,
    unshift = false,
  ): Promise<void> {
    if (typeof textChannel === "boolean") {
      unshift = skip;
      skip = textChannel;
      textChannel = (message as Discord.Message).channel as Discord.TextChannel;
    }
    if (!playlist || !(playlist instanceof Playlist)) throw Error("Invalid Playlist");
    if (this.options.nsfw && !textChannel?.nsfw) {
      playlist.songs = playlist.songs.filter(s => !s.age_restricted);
    }
    if (!playlist.songs.length) {
      if (this.options.nsfw && !textChannel?.nsfw) {
        throw new Error("No valid video in the playlist.\nMaybe age-restricted contents is filtered because you are in non-NSFW channel.");
      }
      throw Error("No valid video in the playlist");
    }
    const songs = playlist.songs;
    const queue = this.distube.getQueue(message);
    if (queue) {
      queue.addToQueue(songs, skip || unshift ? 1 : -1);
      if (skip) queue.skip();
      else this.emit("addList", queue, playlist);
    } else {
      const newQueue = await this.distube._newQueue(message, songs, textChannel);
      if (newQueue instanceof Queue) this.emit("playSong", newQueue, newQueue.songs[0]);
    }
  }

  /**
   * Search for a song, fire {@link DisTube#event:error} if not found.
   * @param {Discord.Message} message A message from guild channel
   * @param {string} query The query string
   * @returns {Promise<SearchResult?>} Song info
   */
  async searchSong(message: Discord.Message, query: string): Promise<SearchResult | null> {
    const limit = this.options.searchSongs > 1 ? this.options.searchSongs : 1;
    const results = await this.distube.search(query, {
      limit,
      safeSearch: this.options.nsfw ? false : !(message.channel as Discord.TextChannel)?.nsfw,
    }).catch(() => undefined);
    if (!results?.length) {
      this.emit("searchNoResult", message, query);
      return null;
    }
    let result = results[0];
    if (limit > 1) {
      this.emit("searchResult", message, results, query);
      const answers = await message.channel
        .awaitMessages((m: Discord.Message) => m.author.id === message.author.id, {
          max: 1,
          time: this.options.searchCooldown * 1e3,
          errors: ["time"],
        }).catch(() => undefined);
      const ans = answers?.first();
      if (!ans) {
        this.emit("searchCancel", message, query);
        return null;
      }
      const index = parseInt(ans.content, 10);
      if (isNaN(index) || index > results.length || index < 1) {
        this.emit("searchCancel", message, query);
        return null;
      }
      this.emit("searchDone", message, ans, query);
      result = results[index - 1];
    }
    return result;
  }

  /**
   * Join the voice channel
   * @param {Queue} queue A message from guild channel
   * @param {Discord.VoiceChannel|Discord.StageChannel} channel The string search for
   * @param {boolean} retried retried?
   * @throws {Error}
   * @returns {Promise<Queue|true>} `true` if queue is not generated
   */
  async joinVoiceChannel(
    queue: Queue,
    channel: Discord.VoiceChannel | Discord.StageChannel,
    retried = false,
  ): Promise<Queue | true> {
    const connection = joinVoiceChannel({
      channelId: channel.id,
      guildId: channel.guild.id,
      adapterCreator: createDiscordJSAdapter(channel),
    });
    try {
      await entersState(connection, VoiceConnectionStatus.Ready, 15e3);
      queue.connection = connection;
      this.distube.connections.set(queue.id, connection);
    } catch (error) {
      connection.destroy();
      if (retried) {
        queue.stop();
        try { error.name = "JoinVCError" } catch { }
        throw error;
      }
      return this.joinVoiceChannel(queue, channel, true);
    }
    this.emit("connect", queue);
    connection.on("stateChange", (_, newState) => {
      if (!connection) return;
      if (newState.status === VoiceConnectionStatus.Disconnected) {
        if (connection.reconnectAttempts < 5) {
          setTimeout(() => {
            if (connection?.state?.status === VoiceConnectionStatus.Disconnected) {
              connection.reconnect();
            }
          }, (connection.reconnectAttempts + 1) * 5e3).unref();
        } else {
          connection.destroy();
        }
      } else if (newState.status === VoiceConnectionStatus.Destroyed) {
        queue.stop();
      }
    });
    connection.on("error", (e: Error) => {
      try { e.name = "ConnectionError" } catch { }
      this.emitError(queue.textChannel, e);
      queue.stop();
    });
    const audioPlayer = queue.audioPlayer = createAudioPlayer();
    audioPlayer.on("stateChange", (oldState, newState) => {
      if (newState.status === AudioPlayerStatus.Idle && oldState.status !== AudioPlayerStatus.Idle) {
        this._handleSongFinish(queue);
      }
    }).on("error", e => this._handlePlayingError(queue, e));
    connection.subscribe(audioPlayer);
    const err = await this.playSong(queue);
    return err || queue;
  }

  /**
   * Create a ytdl stream
   * @param {Queue} queue Queue
   * @returns {Readable}
   */
  createStream(queue: Queue): Readable {
    const song = queue.songs[0];
    const filterArgs: string[] = [];
    queue.filters.forEach((filter: string | number) => filterArgs.push(this.distube.filters[filter]));
    const FFmpegArgs = queue.filters?.length ? ["-af", filterArgs.join(",")] : undefined;
    const seek = song.duration ? queue.beginTime : undefined;
    const streamOptions = { FFmpegArgs, seek };
    Object.assign(streamOptions, this.ytdlOptions);
    if (song.source === "youtube") return DisTubeStream.YouTube(song.info as ytdl.videoInfo, streamOptions);
    return DisTubeStream.DirectLink(song.streamURL as string, streamOptions);
  }

  /**
   * Whether or not emit playSong event
   * @param {Queue} queue Queue
   * @private
   * @returns {boolean}
   */
  _emitPlaySong(queue: Queue): boolean {
    if (
      !this.options.emitNewSongOnly ||
      (queue.repeatMode !== 1 && queue.songs[0]?.id !== queue.songs[1]?.id)
    ) return true;
    return false;
  }

  /**
   * Play a song on voice connection
   * @param {Queue} queue The guild queue
   * @returns {Promise<boolean>} error?
   */
  async playSong(queue: Queue): Promise<boolean> {
    if (!queue) return true;
    if (!queue.songs.length) {
      queue.stop();
      return true;
    }
    queue.playing = true;
    queue.paused = false;
    const song = queue.songs[0];
    try {
      const { url } = song;
      if (song.source === "youtube" && !song.info) song._patchYouTube(await this.getYouTubeInfo(url));
      if (song.source !== "youtube" && !song.streamURL) {
        for (const plugin of [...this.distube.extractorPlugins, ...this.distube.customPlugins]) {
          if (await plugin.validate(url)) {
            const info = [
              plugin.getStreamURL(url),
              plugin.getRelatedSongs(url),
            ] as const;
            const result: any[] = await Promise.all(info);
            song.streamURL = result[0];
            song.related = result[1];
            break;
          }
        }
      }
      queue.audioResource = createAudioResource(this.createStream(queue), { inlineVolume: true });
      queue.audioResource.volume?.setVolume(queue.volume / 100);
      queue.audioPlayer?.play(queue.audioResource);
      return false;
    } catch (e) {
      this._handlePlayingError(queue, e);
      return true;
    }
  }
  /**
   * Handle the queue when a Song finish
   * @private
   * @param {Queue} queue queue
   * @returns {Promise<void>}
   */
  async _handleSongFinish(queue: Queue): Promise<void> {
    this.emit("finishSong", queue, queue.songs[0]);
    if (queue.stopped) return;
    if (queue.repeatMode === 2 && !queue.prev) queue.songs.push(queue.songs[0]);
    if (queue.prev) {
      if (queue.repeatMode === 2) queue.songs.unshift(queue.songs.pop() as Song);
      else queue.songs.unshift(queue.previousSongs.pop() as Song);
    }
    if (queue.songs.length <= 1 && (queue.next || !queue.repeatMode)) {
      if (queue.autoplay) try { await queue.addRelatedSong() } catch { this.emit("noRelated", queue) }
      if (queue.songs.length <= 1) {
        if (this.options.leaveOnFinish) {
          queue.connection?.destroy();
          this.distube.connections.delete(queue.id);
        }
        if (!queue.autoplay) this.emit("finish", queue);
        this.distube._deleteQueue(queue);
        return;
      }
    }
    const emitPlaySong = this._emitPlaySong(queue);
    if (!queue.prev && (queue.repeatMode !== 1 || queue.next)) {
      const prev = queue.songs.shift() as Song;
      delete prev.info;
      delete prev.streamURL;
      if (this.options.savePreviousSongs) queue.previousSongs.push(prev);
      else queue.previousSongs.push({ id: prev.id } as Song);
    }
    queue.next = queue.prev = false;
    queue.beginTime = 0;
    const err = await this.playSong(queue);
    if (!err && emitPlaySong) this.emit("playSong", queue, queue.songs[0]);
  }

  /**
   * Handle error while playing
   * @private
   * @param {Queue} queue queue
   * @param {Error} error error
   */
  _handlePlayingError(queue: Queue, error: Error) {
    const song = queue.songs.shift() as Song;
    try {
      error.name = "PlayingError";
      error.message = `${error.message}\nID: ${song.id}\nName: ${song.name}`;
    } catch { }
    this.emitError(queue.textChannel, error);
    if (queue.songs.length > 0) {
      this.playSong(queue).then(e => {
        if (!e) this.emit("playSong", queue, queue.songs[0]);
      });
    } else queue.stop();
  }

  /**
   * Check if the voice channel is empty
   * @param {Discord.VoiceState} voiceState voiceState
   * @returns {boolean}
   */
  isVoiceChannelEmpty(voiceState: Discord.VoiceState): boolean {
    const voiceChannel = voiceState.guild?.me?.voice?.channel;
    if (!voiceChannel) return false;
    const members = voiceChannel.members.filter(m => !m.user.bot);
    return !members.size;
  }
}

export default DisTubeHandler;
