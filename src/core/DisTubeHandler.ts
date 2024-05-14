import { DisTubeBase } from ".";
import { DisTubeError, Events, Playlist, Queue, Song, isNsfwChannel, isURL } from "..";
import type { VoiceBasedChannel } from "discord.js";
import type { PlayHandlerOptions, ResolveOptions } from "..";

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
   *
   * @throws {@link DisTubeError}
   *
   * @param song    - URL | {@link Song}| {@link SearchResult} | {@link Playlist}
   * @param options - Optional options
   *
   * @returns Resolved
   */
  async resolve(song: string | Song | Playlist, options: ResolveOptions = {}): Promise<Song | Playlist> {
    if (song instanceof Song || song instanceof Playlist) {
      if ("metadata" in options) song.metadata = options.metadata;
      if ("member" in options) song.member = options.member;
      return song;
    }
    if (isURL(song)) {
      for (const plugin of this.distube.extractorPlugins) {
        if (await plugin.validate(song)) return plugin.resolve(song, options);
      }
      throw new DisTubeError("NOT_SUPPORTED_URL");
    }
    throw new DisTubeError("CANNOT_RESOLVE_SONG", song);
  }

  /**
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
   *
   * @param _song - A Song
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async attachStreamInfo(_song: Song) {
    // TODO
  }
}
