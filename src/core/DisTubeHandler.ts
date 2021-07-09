import ytdl from "ytdl-core";
import ytpl from "@distube/ytpl";
import DisTube from "../DisTube";
import { DisTubeBase, DisTubeStream } from ".";
import { OtherSongInfo, Playlist, Queue, SearchResult, Song, isMessageInstance, isURL } from "..";
import { GuildMember, Message, StageChannel, TextChannel, VoiceChannel } from "discord.js";

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
  }

  /**
   * Create a new guild queue
   * @param {Discord.Message|Discord.VoiceChannel|Discord.StageChannel} message A message from guild channel | a voice channel
   * @param {Song|Song[]} song Song to play
   * @param {Discord.TextChannel} textChannel A text channel of the queue
   * @throws {Error}
   * @returns {Promise<Queue|true>} `true` if queue is not generated
   */
  async createQueue(
    message: Message | VoiceChannel | StageChannel,
    song: Song | Song[],
    textChannel: TextChannel = (message as Message).channel as TextChannel,
  ): Promise<Queue | true> {
    const voice = (message as Message)?.member?.voice?.channel || message;
    if (isMessageInstance(voice)) throw new Error("User is not in a voice channel.");
    if (!["GUILD_VOICE", "GUILD_STAGE_VOICE"].includes(voice.type)) {
      throw new TypeError("User is not in a VoiceChannel or a StageChannel.");
    }
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
   * @param {Discord.GuildMember} member Requested user
   * @param {string|Song|SearchResult|Playlist} song URL | Search string | {@link Song}
   * @returns {Promise<Song|Playlist|null>} Resolved
   */
  async resolveSong(
    member: GuildMember,
    song: string | ytdl.videoInfo | Song | Playlist | SearchResult | OtherSongInfo | ytdl.relatedVideo | null,
  ): Promise<Song | Playlist | null> {
    if (!song) return null;
    if (song instanceof Song || song instanceof Playlist) return song;
    if (song instanceof SearchResult) {
      if (song.type === "video") return new Song(song, member);
      /*if (song.type === "playlist")*/ else return this.resolvePlaylist(member, song.url);
    }
    if (typeof song === "object") return new Song(song, member);
    if (ytdl.validateURL(song)) return new Song(await this.getYouTubeInfo(song), member);
    if (isURL(song)) {
      for (const plugin of this.distube.extractorPlugins) {
        if (await plugin.validate(song)) return plugin.resolve(song, member);
      }
      throw new Error("Not Supported URL!");
    }
    throw new TypeError(`${typeof song} cannot resolved to a Song`);
  }

  /**
   * Resole Song[] or url to a Playlist
   * @param {Discord.GuildMember} member Requested user
   * @param {Song[]|string} playlist Resolvable playlist
   * @param {string} [source="youtube"] Playlist source
   * @returns {Promise<Playlist>}
   */
  async resolvePlaylist(
    member: GuildMember,
    playlist: Playlist | Song[] | string,
    source = "youtube",
  ): Promise<Playlist> {
    if (playlist instanceof Playlist) return playlist;
    let solvablePlaylist: Song[] | ytpl.result;
    if (typeof playlist === "string") {
      solvablePlaylist = await ytpl(playlist, { limit: Infinity });
      (solvablePlaylist as any).items = solvablePlaylist.items
        .filter(v => !v.thumbnail.includes("no_thumbnail"))
        .map(v => new Song(v as OtherSongInfo, member));
    } else {
      solvablePlaylist = playlist;
    }
    return new Playlist(solvablePlaylist, member, { source });
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
    message: Message | GuildMember,
    songs: (string | Song | SearchResult)[],
    properties: any = {},
    parallel = true,
  ): Promise<Playlist> {
    const member = (message as Message)?.member || (message as GuildMember);
    if (!Array.isArray(songs)) throw new TypeError("songs must be an array of url");
    if (!songs.length) throw new Error("songs is an empty array");
    songs = songs.filter(
      song => song instanceof Song || (song instanceof SearchResult && song.type === "video") || isURL(song),
    );
    if (!songs.length) throw new Error("songs does not have any valid Song, SearchResult or url");
    let resolvedSongs: Song[];
    if (parallel) {
      const promises = songs.map((song: string | Song | SearchResult) =>
        this.resolveSong(member, song).catch(() => undefined),
      );
      resolvedSongs = (await Promise.all(promises)).filter((s: any): s is Song => !!s);
    } else {
      const resolved = [];
      for (const song of songs) {
        resolved.push(await this.resolveSong(member, song).catch(() => undefined));
      }
      resolvedSongs = resolved.filter((s: any): s is Song => !!s);
    }
    return new Playlist(resolvedSongs, member, properties);
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
    message: Message | VoiceChannel | StageChannel,
    playlist: Playlist,
    textChannel?: TextChannel,
    skip = false,
    unshift = false,
  ): Promise<void> {
    if (!playlist || !(playlist instanceof Playlist)) throw Error("Invalid Playlist");
    if (!this.options.nsfw && !textChannel?.nsfw) playlist.songs = playlist.songs.filter(s => !s.age_restricted);
    if (!playlist.songs.length) {
      if (!this.options.nsfw && !textChannel?.nsfw) {
        throw new Error(
          "No valid video in the playlist.\nMaybe age-restricted contents is filtered because you are in non-NSFW channel.",
        );
      }
      throw Error("No valid video in the playlist");
    }
    const songs = playlist.songs;
    const queue = this.queues.get(message);
    if (queue) {
      queue.addToQueue(songs, skip || unshift ? 1 : -1);
      if (skip) queue.skip();
      else this.emit("addList", queue, playlist);
    } else {
      const newQueue = await this.createQueue(message, songs, textChannel);
      if (newQueue instanceof Queue) this.emit("playSong", newQueue, newQueue.songs[0]);
    }
  }

  /**
   * Search for a song, fire {@link DisTube#event:error} if not found.
   * @param {Discord.Message} message A message from guild channel
   * @param {string} query The query string
   * @returns {Promise<SearchResult?>} Song info
   */
  async searchSong(message: Message, query: string): Promise<SearchResult | null> {
    const limit = this.options.searchSongs > 1 ? this.options.searchSongs : 1;
    const results = await this.distube
      .search(query, {
        limit,
        safeSearch: this.options.nsfw ? false : !(message.channel as TextChannel)?.nsfw,
      })
      .catch(() => undefined);
    if (!results?.length) {
      this.emit("searchNoResult", message, query);
      return null;
    }
    let result = results[0];
    if (limit > 1) {
      this.emit("searchResult", message, results, query);
      const c = message.channel;
      /* eslint-disable @typescript-eslint/indent */ // offsetTernaryExpressions bug
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
      /* eslint-enable @typescript-eslint/indent */
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
    queue.filters.forEach((filter: string | number) => filterArgs.push(this.distube.filters[filter]));
    const ffmpegArgs = queue.filters?.length ? ["-af", filterArgs.join(",")] : undefined;
    const seek = duration ? queue.beginTime : undefined;
    const streamOptions = { ffmpegArgs, seek, isLive };
    Object.assign(streamOptions, this.ytdlOptions);
    if (source === "youtube") return DisTubeStream.YouTube(formats, streamOptions);
    return DisTubeStream.DirectLink(streamURL as string, streamOptions);
  }
}

export default DisTubeHandler;
