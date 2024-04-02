import ytpl from "@distube/ytpl";
import ytdl from "@distube/ytdl-core";
import { DisTubeBase } from ".";
import { Cookie } from "tough-cookie";
import {
  DisTubeError,
  Playlist,
  Queue,
  SearchResultPlaylist,
  SearchResultVideo,
  Song,
  chooseBestVideoFormat,
  isMessageInstance,
  isNsfwChannel,
  isObject,
  isTruthy,
  isURL,
  isVoiceChannelEmpty,
} from "..";
import type { Message, VoiceBasedChannel } from "discord.js";
import type {
  DisTube,
  OtherSongInfo,
  PlayHandlerOptions,
  ResolveOptions,
  ResolvePlaylistOptions,
  SearchResult,
} from "..";

/**
 * @remarks
 * DisTube's Handler
 */
export class DisTubeHandler extends DisTubeBase {
  #cookie: ytdl.Cookie[] | string = "";
  constructor(distube: DisTube) {
    super(distube);

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
        if (queue._emptyTimeout) {
          clearTimeout(queue._emptyTimeout);
          delete queue._emptyTimeout;
        }
        if (isVoiceChannelEmpty(oldState)) {
          queue._emptyTimeout = setTimeout(() => {
            delete queue._emptyTimeout;
            if (isVoiceChannelEmpty(oldState)) {
              queue.voice.leave();
              this.emit("empty", queue);
              if (queue.stopped) queue.remove();
            }
          }, this.options.emptyCooldown * 1e3).unref();
        }
      });
    }
  }

  get ytdlOptions(): ytdl.getInfoOptions {
    const options = this.options.ytdlOptions;
    if (this.options.youtubeCookie && this.options.youtubeCookie !== this.#cookie) {
      const cookies = (this.#cookie = this.options.youtubeCookie);
      if (typeof cookies === "string") {
        // eslint-disable-next-line no-console
        console.warn(
          "\x1b[33mWARNING:\x1B[0m You are using the old YouTube cookie format, " +
            "please use the new one instead. (https://distube.js.org/#/docs/DisTube/main/general/cookie)",
        );
        options.agent = ytdl.createAgent(
          cookies
            .split(";")
            .map(c => Cookie.parse(c))
            .filter(isTruthy),
        );
      } else {
        options.agent = ytdl.createAgent(cookies);
      }
    }
    return options;
  }

  get ytCookie(): string {
    const agent = this.ytdlOptions.agent;
    if (!agent) return "";
    const { jar } = agent;
    return jar.getCookieStringSync("https://www.youtube.com");
  }

  /**
   * @param url   - url
   * @param basic - getBasicInfo?
   */
  getYouTubeInfo(url: string, basic = false): Promise<ytdl.videoInfo> {
    if (basic) return ytdl.getBasicInfo(url, this.ytdlOptions);
    return ytdl.getInfo(url, this.ytdlOptions);
  }

  resolve<T = unknown>(song: Song<T>, options?: Omit<ResolveOptions, "metadata">): Promise<Song<T>>;
  resolve<T = unknown>(song: Playlist<T>, options?: Omit<ResolveOptions, "metadata">): Promise<Playlist<T>>;
  resolve<T = unknown>(song: string | SearchResult, options?: ResolveOptions<T>): Promise<Song<T> | Playlist<T>>;
  resolve<T = unknown>(
    song: ytdl.videoInfo | OtherSongInfo | ytdl.relatedVideo,
    options?: ResolveOptions<T>,
  ): Promise<Song<T>>;
  resolve<T = unknown>(song: Playlist, options: ResolveOptions<T>): Promise<Playlist<T>>;
  resolve(
    song: string | ytdl.videoInfo | Song | Playlist | SearchResult | OtherSongInfo | ytdl.relatedVideo,
    options?: ResolveOptions,
  ): Promise<Song | Playlist>;
  /**
   * @remarks
   * Resolve a url or a supported object to a {@link Song} or {@link Playlist}
   *
   * @throws {@link DisTubeError}
   *
   * @param song    - URL | {@link Song}| {@link SearchResult} | {@link Playlist}
   * @param options - Optional options
   *
   * @returns Resolved
   */
  async resolve(
    song: string | ytdl.videoInfo | Song | Playlist | SearchResult | OtherSongInfo | ytdl.relatedVideo,
    options: ResolveOptions = {},
  ): Promise<Song | Playlist> {
    if (song instanceof Song || song instanceof Playlist) {
      if ("metadata" in options) song.metadata = options.metadata;
      if ("member" in options) song.member = options.member;
      return song;
    }
    if (song instanceof SearchResultVideo) return new Song(song, options);
    if (song instanceof SearchResultPlaylist) return this.resolvePlaylist(song.url, options);
    if (isObject(song)) {
      if (!("url" in song) && !("id" in song)) throw new DisTubeError("CANNOT_RESOLVE_SONG", song);
      return new Song(song, options);
    }
    if (ytpl.validateID(song)) return this.resolvePlaylist(song, options);
    if (ytdl.validateURL(song)) return new Song(await this.getYouTubeInfo(song, true), options);
    if (isURL(song)) {
      for (const plugin of this.distube.extractorPlugins) {
        if (await plugin.validate(song)) return plugin.resolve(song, options);
      }
      throw new DisTubeError("NOT_SUPPORTED_URL");
    }
    throw new DisTubeError("CANNOT_RESOLVE_SONG", song);
  }

  resolvePlaylist<T = unknown>(
    playlist: Playlist<T> | Song<T>[] | string,
    options?: Omit<ResolvePlaylistOptions, "metadata">,
  ): Promise<Playlist<T>>;
  resolvePlaylist<T = undefined>(
    playlist: Playlist | Song[] | string,
    options: ResolvePlaylistOptions<T>,
  ): Promise<Playlist<T>>;
  resolvePlaylist(playlist: Playlist | Song[] | string, options?: ResolvePlaylistOptions): Promise<Playlist>;
  /**
   * @remarks
   * Resolve Song[] or YouTube playlist url to a Playlist
   *
   * @param playlist - Resolvable playlist
   * @param options  - Optional options
   */
  async resolvePlaylist(playlist: Playlist | Song[] | string, options: ResolvePlaylistOptions = {}): Promise<Playlist> {
    const { member, source, metadata } = { source: "youtube", ...options };
    if (playlist instanceof Playlist) {
      if ("metadata" in options) playlist.metadata = metadata;
      if ("member" in options) playlist.member = member;
      return playlist;
    }
    if (typeof playlist === "string") {
      const info = await ytpl(playlist, { limit: Infinity, requestOptions: { headers: { cookie: this.ytCookie } } });
      const songs = info.items
        .filter(v => !v.thumbnail.includes("no_thumbnail"))
        .map(v => new Song(v, { member, metadata }));
      return new Playlist(
        {
          source,
          songs,
          member,
          name: info.title,
          url: info.url,
          thumbnail: songs[0].thumbnail,
        },
        { metadata },
      );
    }
    return new Playlist(playlist, { member, properties: { source }, metadata });
  }

  /**
   * @remarks
   * Search for a song, fire {@link DisTube#(event:error)} if not found.
   *
   * @throws {@link DisTubeError}
   *
   * @param message - The original message from an user
   * @param query   - The query string
   *
   * @returns Song info
   */
  async searchSong(message: Message<true>, query: string): Promise<SearchResult | null> {
    if (!isMessageInstance(message)) throw new DisTubeError("INVALID_TYPE", "Discord.Message", message, "message");
    if (typeof query !== "string") throw new DisTubeError("INVALID_TYPE", "string", query, "query");
    if (query.length === 0) throw new DisTubeError("EMPTY_STRING", "query");
    const limit = this.options.searchSongs > 1 ? this.options.searchSongs : 1;
    const results = await this.distube
      .search(query, {
        limit,
        safeSearch: this.options.nsfw ? false : !isNsfwChannel(message.channel),
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
   * @remarks
   * Create a message collector for selecting search results.
   *
   * Needed events: {@link DisTube#(event:searchResult)}, {@link DisTube#(event:searchCancel)},
   * {@link DisTube#(event:searchInvalidAnswer)}, {@link DisTube#(event:searchDone)}.
   *
   * @throws {@link DisTubeError}
   *
   * @param message - The original message from an user
   * @param results - The search results
   * @param query   - The query string
   *
   * @returns Selected result
   */
  async createSearchMessageCollector<R extends SearchResult | Song | Playlist>(
    message: Message<true>,
    results: Array<R>,
    query?: string,
  ): Promise<R | null> {
    if (!isMessageInstance(message)) throw new DisTubeError("INVALID_TYPE", "Discord.Message", message, "message");
    if (!Array.isArray(results) || results.length === 0) {
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
      const answers = await message.channel
        .awaitMessages({
          filter: (m: Message) => m.author.id === message.author.id,
          max: 1,
          time: this.options.searchCooldown * 1e3,
          errors: ["time"],
        })
        .catch(() => undefined);
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
   * @remarks
   * Play or add a {@link Playlist} to the queue.
   *
   * @throws {@link DisTubeError}
   *
   * @param voiceChannel - A voice channel
   * @param playlist     - A YouTube playlist url | a Playlist
   * @param options      - Optional options
   */
  async playPlaylist(
    voiceChannel: VoiceBasedChannel,
    playlist: Playlist,
    options: PlayHandlerOptions = {},
  ): Promise<void> {
    const { textChannel, skip } = { skip: false, ...options };
    const position = Number(options.position) || (skip ? 1 : 0);
    if (!(playlist instanceof Playlist)) throw new DisTubeError("INVALID_TYPE", "Playlist", playlist, "playlist");

    const queue = this.queues.get(voiceChannel);

    const isNsfw = isNsfwChannel(queue?.textChannel || textChannel);
    if (!this.options.nsfw && !isNsfw) playlist.songs = playlist.songs.filter(s => !s.age_restricted);

    if (!playlist.songs.length) {
      if (!this.options.nsfw && !isNsfw) throw new DisTubeError("EMPTY_FILTERED_PLAYLIST");
      throw new DisTubeError("EMPTY_PLAYLIST");
    }
    if (queue) {
      if (this.options.joinNewVoiceChannel) queue.voice.channel = voiceChannel;
      queue.addToQueue(playlist.songs, position);
      if (skip) queue.skip();
      else this.emit("addList", queue, playlist);
    } else {
      const newQueue = await this.queues.create(voiceChannel, playlist.songs, textChannel);
      if (newQueue instanceof Queue) {
        if (this.options.emitAddListWhenCreatingQueue) this.emit("addList", newQueue, playlist);
        this.emit("playSong", newQueue, newQueue.songs[0]);
      }
    }
  }

  /**
   * @remarks
   * Play or add a {@link Song} to the queue.
   *
   * @throws {@link DisTubeError}
   *
   * @param voiceChannel - A voice channel
   * @param song         - A YouTube playlist url | a Playlist
   * @param options      - Optional options
   */
  async playSong(voiceChannel: VoiceBasedChannel, song: Song, options: PlayHandlerOptions = {}): Promise<void> {
    if (!(song instanceof Song)) throw new DisTubeError("INVALID_TYPE", "Song", song, "song");
    const { textChannel, skip } = { skip: false, ...options };
    const position = Number(options.position) || (skip ? 1 : 0);

    const queue = this.queues.get(voiceChannel);
    if (!this.options.nsfw && song.age_restricted && !isNsfwChannel(queue?.textChannel || textChannel)) {
      throw new DisTubeError("NON_NSFW");
    }
    if (queue) {
      if (this.options.joinNewVoiceChannel) queue.voice.channel = voiceChannel;
      queue.addToQueue(song, position);
      if (skip) queue.skip();
      else this.emit("addSong", queue, song);
    } else {
      const newQueue = await this.queues.create(voiceChannel, song, textChannel);
      if (newQueue instanceof Queue) {
        if (this.options.emitAddSongWhenCreatingQueue) this.emit("addSong", newQueue, song);
        this.emit("playSong", newQueue, song);
      }
    }
  }

  /**
   * @remarks
   * Get {@link Song}'s stream info and attach it to the song.
   *
   * @param song - A Song
   */
  async attachStreamInfo(song: Song) {
    const { url, source, formats, streamURL } = song;
    if (source === "youtube") {
      if (!formats || !chooseBestVideoFormat(song)) {
        song._patchYouTube(await this.handler.getYouTubeInfo(url));
      }
    } else if (!streamURL) {
      for (const plugin of [...this.distube.extractorPlugins, ...this.distube.customPlugins]) {
        if (await plugin.validate(url)) {
          const info = [plugin.getStreamURL(url), plugin.getRelatedSongs(url)] as const;
          const result = await Promise.all(info);
          song.streamURL = result[0];
          song.related = result[1];
          break;
        }
      }
    }
  }
}
