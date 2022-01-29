import ytdl from "@distube/ytdl-core";
import ytpl from "@distube/ytpl";
import { DisTubeBase, DisTubeStream } from ".";
import {
  DisTubeError,
  Playlist,
  Queue,
  SearchResult,
  Song,
  isMessageInstance,
  isSupportedVoiceChannel,
  isURL,
  isVoiceChannelEmpty,
} from "..";
import type { DisTube, OtherSongInfo } from "..";
import type { GuildMember, GuildTextBasedChannel, Message, TextChannel, VoiceBasedChannel } from "discord.js";
/**
 * DisTube's Handler
 * @extends DisTubeBase
 * @private
 */
export class DisTubeHandler extends DisTubeBase {
  ytdlOptions: ytdl.downloadOptions;
  constructor(distube: DisTube) {
    super(distube);
    this.ytdlOptions = this.options.ytdlOptions;

    if (this.options.youtubeCookie) {
      const requestOptions: any = {
        headers: {
          cookie: this.options.youtubeCookie,
        },
      };
      if (this.options.youtubeIdentityToken) {
        requestOptions.headers["x-youtube-identity-token"] = this.options.youtubeIdentityToken;
      }
      Object.assign(this.ytdlOptions, { requestOptions });
    }

    const client = this.client;
    if (this.options.leaveOnEmpty) {
      client.on("voiceStateUpdate", oldState => {
        if (!oldState?.channel) return;
        const queue = this.queues.get(oldState);
        if (!queue) {
          if (isVoiceChannelEmpty(oldState)) {
            setTimeout(() => {
              if (!this.queues.get(oldState) && isVoiceChannelEmpty(oldState)) this.voices.leave(oldState);
            }, this.options.emptyCooldown * 1e3).unref();
          }
          return;
        }
        if (queue.emptyTimeout) {
          clearTimeout(queue.emptyTimeout);
          delete queue.emptyTimeout;
        }
        if (isVoiceChannelEmpty(oldState)) {
          queue.emptyTimeout = setTimeout(() => {
            delete queue.emptyTimeout;
            if (isVoiceChannelEmpty(oldState)) {
              queue.voice.leave();
              this.emit("empty", queue);
              if (queue.stopped) queue.delete();
            }
          }, this.options.emptyCooldown * 1e3).unref();
        }
      });
    }
  }

  /**
   * Create a new guild queue
   * @param {Discord.Message|Discord.VoiceChannel|Discord.StageChannel} message A user message | a voice channel
   * @param {Song|Song[]} song Song to play
   * @param {Discord.BaseGuildTextChannel?} textChannel A text channel of the queue
   * @throws {Error}
   * @returns {Promise<Queue|true>} `true` if queue is not generated
   * @deprecated Use {@link QueueManager#create} instead
   */
  async createQueue(
    message: Message<true> | VoiceBasedChannel,
    song: Song | Song[],
    textChannel?: GuildTextBasedChannel,
  ): Promise<Queue | true> {
    process.emitWarning(
      "DisTubeHandler#createQueue is deprecated, use QueueManager#create instead.",
      "DeprecationWarning",
    );
    let voice: VoiceBasedChannel | undefined;
    if (isMessageInstance(message)) {
      textChannel = message.channel;
      voice = message.member?.voice?.channel ?? undefined;
    } else {
      voice = message;
    }
    if (!voice) throw new DisTubeError("NOT_IN_VOICE");
    if (!isSupportedVoiceChannel(voice)) throw new DisTubeError("INVALID_TYPE", "BaseGuildVoiceChannel", voice);
    return this.queues.create(voice, song, textChannel);
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
   * @param {string|Song|SearchResult|Playlist} song URL | Search string | {@link Song}
   * @param {Object} [options] Optional options
   * @param {Discord.GuildMember} [options.member] Requested user
   * @param {*} [options.metadata] Metadata
   * @returns {Promise<Song|Playlist|null>} Resolved
   */
  async resolveSong(
    song: string | ytdl.videoInfo | Song | Playlist | SearchResult | OtherSongInfo | ytdl.relatedVideo | null,
    options: {
      member?: GuildMember;
      metadata?: any;
    } = {},
  ): Promise<Song | Playlist | null> {
    if (!song) return null;
    if (song instanceof Song || song instanceof Playlist) {
      if (options.metadata) song._patchMetadata(options.metadata);
      if (options.member) song._patchMember(options.member);
      return song;
    }
    if (song instanceof SearchResult) {
      if (song.type === "video") return new Song(song, options);
      return this.resolvePlaylist(song.url, options);
    }
    if (typeof song === "object") return new Song(song, options);
    if (ytdl.validateURL(song)) return new Song(await this.getYouTubeInfo(song), options);
    if (isURL(song)) {
      for (const plugin of this.distube.extractorPlugins) {
        if (await plugin.validate(song)) return plugin.resolve(song, options);
      }
      throw new DisTubeError("NOT_SUPPORTED_URL");
    }
    throw new DisTubeError("CANNOT_RESOLVE_SONG", typeof song);
  }

  /**
   * Resolve Song[] or url to a Playlist
   * @param {Playlist|Song[]|string} playlist Resolvable playlist
   * @param {Object} options Optional options
   * @param {Discord.GuildMember} [options.member] Requested user
   * @param {string} [options.source="youtube"] Playlist source
   * @param {*} [options.metadata] Metadata
   * @returns {Promise<Playlist>}
   */
  async resolvePlaylist(
    playlist: Playlist | Song[] | string,
    options: {
      member?: GuildMember;
      source?: string;
      metadata?: any;
    } = {},
  ): Promise<Playlist> {
    const { member, source, metadata } = Object.assign({ source: "youtube" }, options);
    if (playlist instanceof Playlist) {
      if (metadata) playlist._patchMetadata(metadata);
      if (member) playlist._patchMember(member);
      return playlist;
    }
    let solvablePlaylist: Song[] | ytpl.result;
    if (typeof playlist === "string") {
      solvablePlaylist = await ytpl(playlist, { limit: Infinity });
      (solvablePlaylist as any).items = solvablePlaylist.items
        .filter(v => !v.thumbnail.includes("no_thumbnail"))
        .map(v => new Song(v as OtherSongInfo, { member, metadata }));
    } else {
      solvablePlaylist = playlist;
    }
    return new Playlist(solvablePlaylist, { member, properties: { source }, metadata });
  }

  /**
   * Create a custom playlist
   * @returns {Promise<Playlist>}
   * @param {Discord.Message|Discord.GuildMember} message A message from guild channel | A guild member
   * @param {Array<string|Song|SearchResult>} songs Array of url, Song or SearchResult
   * @param {Object} [properties={}] Additional properties such as `name`
   * @param {boolean} [parallel=true] Whether or not fetch the songs in parallel
   * @param {*} [metadata] Metadata
   * @deprecated Use {@link DisTube#createCustomPlaylist} instead
   */
  async createCustomPlaylist(
    message: Message<true> | GuildMember,
    songs: (string | Song | SearchResult)[],
    properties: any = {},
    parallel = true,
    metadata?: any,
  ): Promise<Playlist> {
    process.emitWarning(
      "DisTubeHandler#createCustomPlaylist is deprecated, use DisTube#createCustomPlaylist instead.",
      "DeprecationWarning",
    );
    return this.distube.createCustomPlaylist(songs, {
      member: (message as Message<true>).member ?? (message as GuildMember),
      properties,
      parallel,
      metadata,
    });
  }

  /**
   * Play / add a playlist
   * @returns {Promise<void>}
   * @param {Discord.BaseGuildVoiceChannel} voice A voice channel
   * @param {Playlist|string} playlist A YouTube playlist url | a Playlist
   * @param {Object} [options] Optional options
   * @param {Discord.BaseGuildTextChannel} [options.textChannel] The default text channel of the queue
   * @param {boolean} [options.skip=false] Skip the playing song (if exists) and play the added playlist instantly
   * @param {boolean} [options.unshift=false] Add the playlist after the playing song if exists
   */
  async handlePlaylist(
    voice: VoiceBasedChannel,
    playlist: Playlist,
    options: {
      textChannel?: GuildTextBasedChannel;
      skip?: boolean;
      unshift?: boolean;
    } = {},
  ): Promise<void> {
    const { textChannel, skip, unshift } = Object.assign({ skip: false, unshift: false }, options);
    if (!(playlist instanceof Playlist)) throw new DisTubeError("INVALID_TYPE", "Playlist", playlist, "playlist");
    if (!this.options.nsfw && !(textChannel as TextChannel)?.nsfw) {
      playlist.songs = playlist.songs.filter(s => !s.age_restricted);
    }
    if (!playlist.songs.length) {
      if (!this.options.nsfw && !(textChannel as TextChannel)?.nsfw) throw new DisTubeError("EMPTY_FILTERED_PLAYLIST");
      throw new DisTubeError("EMPTY_PLAYLIST");
    }
    const songs = playlist.songs;
    const queue = this.queues.get(voice);
    if (queue) {
      queue.addToQueue(songs, skip || unshift ? 1 : -1);
      if (skip) queue.skip();
      else this.emit("addList", queue, playlist);
    } else {
      const newQueue = await this.queues.create(voice, songs, textChannel);
      if (newQueue instanceof Queue) {
        if (this.options.emitAddListWhenCreatingQueue) this.emit("addList", newQueue, playlist);
        this.emit("playSong", newQueue, newQueue.songs[0]);
      }
    }
  }

  /**
   * Search for a song, fire {@link DisTube#event:error} if not found.
   * @param {Discord.Message} message The original message from an user
   * @param {string} query The query string
   * @returns {Promise<SearchResult?>} Song info
   */
  async searchSong(message: Message<true>, query: string): Promise<SearchResult | null> {
    if (!isMessageInstance(message)) throw new DisTubeError("INVALID_TYPE", "Discord.Message", message, "message");
    if (typeof query !== "string") throw new DisTubeError("INVALID_TYPE", "string", query, "query");
    if (query.length === 0) throw new DisTubeError("EMPTY_STRING", "query");
    const limit = this.options.searchSongs > 1 ? this.options.searchSongs : 1;
    const results = await this.distube
      .search(query, {
        limit,
        safeSearch: this.options.nsfw ? false : !(message.channel as TextChannel)?.nsfw,
      })
      .catch(() => {
        if (!this.emit("searchNoResult", message, query)) {
          // eslint-disable-next-line no-console
          console.warn("searchNoResult event does not have any listeners! Emits `error` event instead.");
          throw new DisTubeError("NO_RESULT");
        }
      });
    if (!results) return null;
    return this.createSearchMessageCollector(message, results, query);
  }

  /**
   * Create a message collector for selecting search results.
   *
   * Needed events: {@link DisTube#event:searchResult}, {@link DisTube#event:searchCancel},
   * {@link DisTube#event:searchInvalidAnswer}, {@link DisTube#event:searchDone}.
   * @param {Discord.Message} message The original message from an user
   * @param {Array<SearchResult|Song|Playlist>} results The search results
   * @param {string?} [query] The query string
   * @returns {Promise<SearchResult|Song|Playlist|null>} Selected result
   */
  async createSearchMessageCollector<R extends SearchResult | Song | Playlist>(
    message: Message<true>,
    results: Array<R>,
    query?: string,
  ): Promise<R | null> {
    if (!isMessageInstance(message)) throw new DisTubeError("INVALID_TYPE", "Discord.Message", message, "message");
    if (!Array.isArray(results) || results.length == 0) {
      throw new DisTubeError("INVALID_TYPE", "Array<SearchResult|Song|Playlist>", results, "results");
    }
    if (this.options.searchSongs > 1) {
      const searchEvents = [
        "searchNoResult",
        "searchResult",
        "searchCancel",
        "searchInvalidAnswer",
        "searchDone",
      ] as const;
      for (const evn of searchEvents) {
        if (this.distube.listenerCount(evn) === 0) {
          /* eslint-disable no-console */
          console.warn(`"searchSongs" option is disabled due to missing "${evn}" listener.`);
          console.warn(
            `If you don't want to use "${evn}" event, simply add an empty listener (not recommended):\n` +
              `<DisTube>.on("${evn}", () => {})`,
          );
          /* eslint-enable no-console */
          this.options.searchSongs = 0;
        }
      }
    }
    const limit = this.options.searchSongs > 1 ? this.options.searchSongs : 1;
    let result = results[0];
    if (limit > 1) {
      results.splice(limit);
      this.emit("searchResult", message, results, query);
      const c = message.channel;
      const answers = await (c.awaitMessages.length === 0
        ? c.awaitMessages({
            filter: (m: Message) => m.author.id === message.author.id,
            max: 1,
            time: this.options.searchCooldown * 1e3,
            errors: ["time"],
          })
        : (c.awaitMessages as any)((m: Message) => m.author.id === message.author.id, {
            max: 1,
            time: this.options.searchCooldown * 1e3,
            errors: ["time"],
          })
      ).catch(() => undefined);
      const ans = answers?.first();
      if (!ans) {
        this.emit("searchCancel", message, query);
        return null;
      }
      const index = parseInt(ans.content, 10);
      if (isNaN(index) || index > results.length || index < 1) {
        this.emit("searchInvalidAnswer", message, ans, query);
        return null;
      }
      this.emit("searchDone", message, ans, query);
      result = results[index - 1];
    }
    return result;
  }

  /**
   * Create a ytdl stream
   * @param {Queue} queue Queue
   * @returns {DisTubeStream}
   */
  createStream(queue: Queue): DisTubeStream {
    const { duration, formats, isLive, source, streamURL } = queue.songs[0];
    const filterArgs: string[] = [];
    queue.filters.forEach((filter: string | number) => filterArgs.push(queue.customFilters[filter] ?? this.distube.filters[filter]));
    const ffmpegArgs = queue.filters?.length ? ["-af", filterArgs.join(",")] : undefined;
    const seek = duration ? queue.beginTime : undefined;
    const streamOptions = { ffmpegArgs, seek, isLive };
    Object.assign(streamOptions, this.ytdlOptions);
    if (source === "youtube") return DisTubeStream.YouTube(formats, streamOptions);
    return DisTubeStream.DirectLink(streamURL as string, streamOptions);
  }
}
