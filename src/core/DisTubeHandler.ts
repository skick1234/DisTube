import ytdl from "ytdl-core";
import ytpl from "@distube/ytpl";
import DisTube from "../DisTube";
import { Readable } from "stream";
import { DisTubeBase } from ".";
import { DisTubeStream, OtherSongInfo, Playlist, Queue, SearchResult, Song, isURL } from "..";
import { GuildMember, Message, StageChannel, TextChannel, VoiceChannel, VoiceState } from "discord.js";

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
   * @param {string|Song|SearchResult|Playlist} song YouTube url | Search string | {@link Song}
   * @returns {Promise<Song|Playlist>} Resolved Song
   */
  async resolveSong(
    member: GuildMember,
    song: string | ytdl.videoInfo | Song | Playlist | SearchResult | OtherSongInfo | ytdl.relatedVideo | null,
  ): Promise<Song | Playlist | null> {
    if (!song) return null;
    if (song instanceof Song || song instanceof Playlist) return song;
    if (song instanceof SearchResult) {
      if (song.type === "video") return new Song(song, member);
      else if (song.type === "playlist") return this.resolvePlaylist(member, song.url);
      throw new Error("Invalid SearchResult");
    }
    if (typeof song === "object") return new Song(song, member);
    if (ytdl.validateURL(song)) return new Song(await this.getYouTubeInfo(song), member);
    if (isURL(song)) {
      for (const plugin of this.distube.extractorPlugins) if (await plugin.validate(song)) return plugin.resolve(song, member);
      throw new Error("Not Supported URL!");
    }
    throw new TypeError("song is not a valid type");
  }

  /**
   * Resole Song[] or url to a Playlist
   * @param {Discord.GuildMember} member Requested user
   * @param {Song[]|string} playlist Resolvable playlist
   * @param {string} [source="youtube"] Playlist source
   * @returns {Promise<Playlist>}
   */
  async resolvePlaylist(member: GuildMember, playlist: Song[] | string, source = "youtube"): Promise<Playlist> {
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
    message: Message | GuildMember,
    songs: (string | Song | SearchResult)[],
    properties: any = {},
    parallel = true,
  ): Promise<Playlist> {
    const member = (message as Message)?.member || message as GuildMember;
    if (!Array.isArray(songs)) throw new TypeError("songs must be an array of url");
    if (!songs.length) throw new Error("songs is an empty array");
    songs = songs.filter(song => song instanceof Song || song instanceof SearchResult || isURL(song));
    if (!songs.length) throw new Error("songs does not have any valid Song, SearchResult or url");
    let resolvedSongs: (Song | SearchResult)[];
    if (parallel) {
      const promises = songs.map((song: string | Song | SearchResult) => this.resolveSong(member, song).catch(() => null));
      resolvedSongs = (await Promise.all(promises)).filter((s: any): s is Song => !!s);
    } else {
      const resolved = [];
      for (const song of songs) resolved.push(await this.resolveSong(member, song).catch(() => undefined));
      resolvedSongs = resolved.filter((s: any): s is Song => !!s);
    }
    return new Playlist(resolvedSongs.map(s => {
      if (s instanceof Song) return s;
      return new Song(s, member);
    }), member, properties);
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
    textChannel: TextChannel | boolean = false,
    skip = false,
    unshift = false,
  ): Promise<void> {
    if (typeof textChannel === "boolean") {
      unshift = skip;
      skip = textChannel;
      textChannel = (message as Message).channel as TextChannel;
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
  async searchSong(message: Message, query: string): Promise<SearchResult | null> {
    const limit = this.options.searchSongs > 1 ? this.options.searchSongs : 1;
    const results = await this.distube.search(query, {
      limit,
      safeSearch: this.options.nsfw ? false : !(message.channel as TextChannel)?.nsfw,
    }).catch(() => undefined);
    if (!results?.length) {
      this.emit("searchNoResult", message, query);
      return null;
    }
    let result = results[0];
    if (limit > 1) {
      this.emit("searchResult", message, results, query);
      const answers = await message.channel
        .awaitMessages((m: Message) => m.author.id === message.author.id, {
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
      const stream = this.createStream(queue);
      queue.voice.play(stream);
      return false;
    } catch (e) {
      this.queues._handlePlayingError(queue, e);
      return true;
    }
  }

  /**
   * Check if the voice channel is empty
   * @param {Discord.VoiceState} voiceState voiceState
   * @returns {boolean}
   */
  isVoiceChannelEmpty(voiceState: VoiceState): boolean {
    const voiceChannel = voiceState.guild?.me?.voice?.channel;
    if (!voiceChannel) return false;
    const members = voiceChannel.members.filter(m => !m.user.bot);
    return !members.size;
  }
}

export default DisTubeHandler;
