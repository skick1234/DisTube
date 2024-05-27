import { DisTubeBase } from ".";
import { DisTubeError, Events, Playlist, PluginType, Queue, Song, isNsfwChannel, isURL } from "..";
import type { VoiceBasedChannel } from "discord.js";
import type { PlayHandlerOptions, ResolveOptions } from "..";
import { request } from "undici";

const REDIRECT_CODES = new Set([301, 302, 303, 307, 308]);

/**
 * DisTube's Handler
 */
export class DisTubeHandler extends DisTubeBase {
  resolve<T = unknown>(song: Song<T>, options?: Omit<ResolveOptions, "metadata">): Promise<Song<T>>;
  resolve<T = unknown>(song: Playlist<T>, options?: Omit<ResolveOptions, "metadata">): Promise<Playlist<T>>;
  resolve<T = unknown>(song: string, options?: ResolveOptions<T>): Promise<Song<T> | Playlist<T>>;
  resolve<T = unknown>(song: Song, options: ResolveOptions<T>): Promise<Song<T>>;
  resolve<T = unknown>(song: Playlist, options: ResolveOptions<T>): Promise<Playlist<T>>;
  resolve(song: string | Song | Playlist, options?: ResolveOptions): Promise<Song | Playlist>;
  /**
   * Resolve a url or a supported object to a {@link Song} or {@link Playlist}
   * @throws {@link DisTubeError}
   * @param input    - Resolvable input
   * @param options - Optional options
   * @returns Resolved
   */
  async resolve(input: string | Song | Playlist, options: ResolveOptions = {}): Promise<Song | Playlist> {
    if (input instanceof Song || input instanceof Playlist) {
      if ("metadata" in options) input.metadata = options.metadata;
      if ("member" in options) input.member = options.member;
      return input;
    }
    if (isURL(input)) {
      for (const plugin of this.plugins) {
        if (await plugin.validate(input)) return plugin.resolve(input, options);
      }
      input = await this.followRedirectLink(input);
      for (const plugin of this.plugins) {
        if (await plugin.validate(input)) return plugin.resolve(input, options);
      }
      throw new DisTubeError("NOT_SUPPORTED_URL");
    }
    if (typeof input === "string") {
      for (const plugin of this.plugins) {
        if (plugin.type === PluginType.EXTRACTOR) {
          const result = await plugin.searchSong(input, options);
          if (result) return result;
        }
      }
    }
    throw new DisTubeError("CANNOT_RESOLVE_SONG", input);
  }

  /**
   * Play or add a {@link Playlist} to the queue.
   * @throws {@link DisTubeError}
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
    if (!this.options.nsfw && !isNsfw) playlist.songs = playlist.songs.filter(s => !s.ageRestricted);

    if (!playlist.songs.length) {
      if (!this.options.nsfw && !isNsfw) throw new DisTubeError("EMPTY_FILTERED_PLAYLIST");
      throw new DisTubeError("EMPTY_PLAYLIST");
    }
    if (queue) {
      if (this.options.joinNewVoiceChannel) queue.voice.channel = voiceChannel;
      queue.addToQueue(playlist.songs, position);
      if (skip) queue.skip();
      else this.emit(Events.ADD_LIST, queue, playlist);
    } else {
      const newQueue = await this.queues.create(voiceChannel, playlist.songs, textChannel);
      if (newQueue instanceof Queue) {
        if (this.options.emitAddListWhenCreatingQueue) this.emit(Events.ADD_LIST, newQueue, playlist);
        this.emit(Events.PLAY_SONG, newQueue, newQueue.songs[0]);
      }
    }
  }

  /**
   * Play or add a {@link Song} to the queue.
   * @throws {@link DisTubeError}
   * @param voiceChannel - A voice channel
   * @param song         - A YouTube playlist url | a Playlist
   * @param options      - Optional options
   */
  async playSong(voiceChannel: VoiceBasedChannel, song: Song, options: PlayHandlerOptions = {}): Promise<void> {
    if (!(song instanceof Song)) throw new DisTubeError("INVALID_TYPE", "Song", song, "song");
    const { textChannel, skip } = { skip: false, ...options };
    const position = Number(options.position) || (skip ? 1 : 0);

    const queue = this.queues.get(voiceChannel);
    if (!this.options.nsfw && song.ageRestricted && !isNsfwChannel(queue?.textChannel || textChannel)) {
      throw new DisTubeError("NON_NSFW");
    }
    if (queue) {
      if (this.options.joinNewVoiceChannel) queue.voice.channel = voiceChannel;
      queue.addToQueue(song, position);
      if (skip) queue.skip();
      else this.emit(Events.ADD_SONG, queue, song);
    } else {
      const newQueue = await this.queues.create(voiceChannel, song, textChannel);
      if (newQueue instanceof Queue) {
        if (this.options.emitAddSongWhenCreatingQueue) this.emit(Events.ADD_SONG, newQueue, song);
        this.emit(Events.PLAY_SONG, newQueue, song);
      }
    }
  }

  /**
   * Get {@link Song}'s stream info and attach it to the song.
   * @param song - A Song
   */
  async attachStreamInfo(song: Song) {
    if (song.stream.playFromSource) {
      if (song.stream.url) return;
      if (song.plugin?.type === PluginType.EXTRACTOR || song.plugin?.type === PluginType.PLAYABLE_EXTRACTOR) {
        song.stream.url = await song.plugin.getStreamURL(song);
      }
      if (song.url && !song.stream.url) {
        for (const plugin of this.plugins) {
          if (
            (plugin.type === PluginType.EXTRACTOR || plugin.type === PluginType.PLAYABLE_EXTRACTOR) &&
            (await plugin.validate(song.url))
          ) {
            song.stream.url = await plugin.getStreamURL(song);
            break;
          }
        }
      }
      if (!song.stream.url) throw new DisTubeError("CANNOT_GET_STREAM_URL", `${song.name || song.url || song.id}`);
    } else {
      if (song.stream.song?.stream?.playFromSource && song.stream.song.stream.url) return;
      let query: string | undefined;
      if (song.plugin?.type === PluginType.INFO_EXTRACTOR) {
        query = await song.plugin.createSearchQuery(song);
      } else if (song.url) {
        for (const plugin of this.plugins) {
          if (plugin.type === PluginType.INFO_EXTRACTOR && (await plugin.validate(song.url))) {
            query = await plugin.createSearchQuery(song);
            break;
          }
        }
      }
      if (!query) throw new DisTubeError("CANNOT_GET_SEARCH_QUERY", `${song.name || song.url || song.id}`);
      for (const plugin of this.plugins) {
        if (plugin.type === PluginType.EXTRACTOR) {
          try {
            const s = await plugin.searchSong(query, { metadata: song.metadata, member: song.member });
            if (s && s.stream.playFromSource === true) {
              s.stream.url = await plugin.getStreamURL(s);
              song.stream.song = s;
              break;
            }
          } catch {}
        }
      }
      if (!song.stream.song) {
        throw new DisTubeError("CANNOT_GET_SONG_FROM_SEARCH", `${query || song.name || song.url || song.id}`);
      }
    }
  }

  async followRedirectLink(url: string, maxRedirect = 5): Promise<string> {
    if (maxRedirect === 0) return url;

    const res = await request(url, {
      method: "HEAD",
      headers: {
        "user-agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) " +
          "Chrome/125.0.0.0 Safari/537.36",
      },
    });

    if (REDIRECT_CODES.has(res.statusCode ?? 200)) {
      let location = res.headers.location;
      if (typeof location !== "string") location = location?.[0] ?? url;
      return this.followRedirectLink(location, --maxRedirect);
    }

    return url;
  }
}
