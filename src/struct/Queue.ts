import { DisTubeBase } from "../core";
import { DisTubeError, Song, TaskQueue, formatDuration } from "..";
import type { GuildMember, Snowflake, TextChannel } from "discord.js";
import type { DisTube, DisTubeVoice, DisTubeVoiceEvents, SearchResult } from "..";

/**
 * Represents a queue.
 * @extends DisTubeBase
 */
export class Queue extends DisTubeBase {
  id: Snowflake;
  /**
   * Voice connection of this queue
   */
  voice: DisTubeVoice;
  /**
   * List of songs in the queue (The first one is the playing song)
   */
  songs: Song[];
  /**
   * List of the previous songs.
   */
  previousSongs: Song[];
  /**
   * Whether stream is currently stopped.
   * @private
   */
  stopped: boolean;
  /**
   * Whether or not the last song was skipped to next song.
   * @private
   */
  next: boolean;
  /**
   * Whether or not the last song was skipped to previous song.
   * @private
   */
  prev: boolean;
  /**
   * Whether or not the stream is currently playing.
   */
  playing: boolean;
  /**
   * Whether or not the stream is currently paused.
   */
  paused: boolean;
  /**
   * Type of repeat mode (`0` is disabled, `1` is repeating a song, `2` is repeating all the queue).
   * Default value: `0` (disabled)
   */
  repeatMode: number;
  /**
   * Whether or not the autoplay mode is enabled.
   * Default value: `false`
   */
  autoplay: boolean;
  /**
   * Enabled audio filters.
   * Available filters: {@link Filters}
   */
  filters: string[];
  /**
   * What time in the song to begin (in seconds).
   */
  beginTime: number;
  /**
   * The text channel of the Queue. (Default: where the first command is called).
   */
  textChannel?: TextChannel;
  /**
   * Timeout for checking empty channel
   * @private
   */
  emptyTimeout?: NodeJS.Timeout;
  /**
   * The client user as a `GuildMember` of this queue's guild
   */
  clientMember: GuildMember;
  /**
   * Task queuing system
   */
  taskQueue: TaskQueue;
  listeners?: DisTubeVoiceEvents;
  /**
   * Create a queue for the guild
   * @param {DisTube} distube DisTube
   * @param {DisTubeVoice} voice Voice connection
   * @param {Song|Song[]} song First song(s)
   * @param {Discord.TextChannel?} textChannel Default text channel
   */
  constructor(distube: DisTube, voice: DisTubeVoice, song: Song | Song[], textChannel?: TextChannel) {
    super(distube);
    /**
     * The client user as a `GuildMember` of this queue's guild
     * @type {Discord.GuildMember}
     */
    this.clientMember = voice.channel.guild?.me as GuildMember;
    /**
     * Voice connection of this queue.
     * @type {DisTubeVoice}
     */
    this.voice = voice;
    /**
     * Queue id (Guild id)
     * @type {Discord.Snowflake}
     */
    this.id = voice.id;
    /**
     * Get or set the stream volume. Default value: `50`.
     * @type {number}
     */
    this.volume = 50;
    /**
     * List of songs in the queue (The first one is the playing song)
     * @type {Array<Song>}
     */
    this.songs = Array.isArray(song) ? [...song] : [song];
    /**
     * List of the previous songs.
     * @type {Array<Song>}
     */
    this.previousSongs = [];
    /**
     * Whether stream is currently stopped.
     * @type {boolean}
     * @private
     */
    this.stopped = false;
    /**
     * Whether or not the last song was skipped to next song.
     * @type {boolean}
     * @private
     */
    this.next = false;
    /**
     * Whether or not the last song was skipped to previous song.
     * @type {boolean}
     * @private
     */
    this.prev = false;
    /**
     * Whether or not the stream is currently playing.
     * @type {boolean}
     */
    this.playing = true;
    /**
     * Whether or not the stream is currently paused.
     * @type {boolean}
     */
    this.paused = false;
    /**
     * Type of repeat mode (`0` is disabled, `1` is repeating a song, `2` is repeating all the queue).
     * Default value: `0` (disabled)
     * @type {number}
     */
    this.repeatMode = 0;
    /**
     * Whether or not the autoplay mode is enabled.
     * Default value: `false`
     * @type {boolean}
     */
    this.autoplay = false;
    /**
     * Enabled audio filters.
     * Available filters: {@link Filters}
     * @type {Array<string>}
     */
    this.filters = [];
    /**
     * What time in the song to begin (in seconds).
     * @type {number}
     */
    this.beginTime = 0;
    /**
     * The text channel of the Queue. (Default: where the first command is called).
     * @type {Discord.TextChannel?}
     */
    this.textChannel = textChannel;
    /**
     * Timeout for checking empty channel
     * @type {*}
     * @private
     */
    this.emptyTimeout = undefined;
    /**
     * Task queuing system
     * @type {TaskQueue}
     * @private
     */
    this.taskQueue = new TaskQueue();
    /**
     * DisTubeVoice listener
     * @type {Object}
     * @private
     */
    this.listeners = undefined;
  }
  /**
   * Formatted duration string.
   * @type {string}
   */
  get formattedDuration() {
    return formatDuration(this.duration);
  }
  /**
   * Queue's duration.
   * @type {number}
   */
  get duration() {
    return this.songs.length ? this.songs.reduce((prev, next) => prev + next.duration, 0) : 0;
  }
  /**
   * What time in the song is playing (in seconds).
   * @type {number}
   */
  get currentTime() {
    return this.voice.playbackDuration + this.beginTime;
  }
  /**
   * Formatted {@link Queue#currentTime} string.
   * @type {string}
   */
  get formattedCurrentTime() {
    return formatDuration(this.currentTime);
  }
  /**
   * The voice channel playing in.
   * @type {Discord.VoiceChannel|Discord.StageChannel|null}
   */
  get voiceChannel() {
    return this.clientMember.voice.channel;
  }
  get volume() {
    return this.voice.volume;
  }
  set volume(value: number) {
    this.voice.volume = value;
  }
  /**
   * Add a Song or an array of Song to the queue
   * @param {Song|Song[]} song Song to add
   * @param {number} [position=-1] Position to add, < 0 to add to the end of the queue
   * @param {boolean} [queuing=true] Wether or not waiting for unfinished tasks
   * @throws {Error}
   * @returns {Queue} The guild queue
   */
  addToQueue(song: Song | SearchResult | (Song | SearchResult)[], position = -1): Queue {
    const isArray = Array.isArray(song);
    if (!song || (isArray && !(song as Song[]).length)) {
      throw new DisTubeError("INVALID_TYPE", ["Song", "SearchResult", "Array<Song|SearchResult>"], song, "song");
    }
    if (position === 0) throw new DisTubeError("ADD_BEFORE_PLAYING");
    if (position < 0) {
      if (isArray) this.songs.push(...(song as Song[]));
      else this.songs.push(song as Song);
    } else if (isArray) {
      this.songs.splice(position, 0, ...(song as Song[]));
    } else {
      this.songs.splice(position, 0, song as Song);
    }
    if (isArray) (song as Song[]).map(s => delete s.formats);
    else delete (song as Song).formats;
    return this;
  }
  /**
   * Pause the guild stream
   * @returns {Queue} The guild queue
   */
  pause(): Queue {
    if (this.paused) throw new DisTubeError("PAUSED");
    this.playing = false;
    this.paused = true;
    this.voice.pause();
    return this;
  }
  /**
   * Resume the guild stream
   * @returns {Queue} The guild queue
   */
  resume(): Queue {
    if (this.playing) throw new DisTubeError("RESUMED");
    this.playing = true;
    this.paused = false;
    this.voice.unpause();
    return this;
  }
  /**
   * Set the guild stream's volume
   * @param {number} percent The percentage of volume you want to set
   * @returns {Queue} The guild queue
   */
  setVolume(percent: number): Queue {
    this.volume = percent;
    return this;
  }

  /**
   * Skip the playing song
   * @returns {Promise<Song>} The song will skip to
   * @throws {Error}
   */
  async skip(): Promise<Song> {
    await this.taskQueue.queuing();
    try {
      if (this.songs.length <= 1) {
        if (this.autoplay) await this.addRelatedSong();
        else throw new DisTubeError("NO_UP_NEXT");
      }
      const song = this.songs[1];
      this.next = true;
      this.voice.stop();
      return song;
    } finally {
      this.taskQueue.resolve();
    }
  }

  /**
   * Play the previous song
   * @returns {Song} The guild queue
   * @throws {Error}
   */
  async previous(): Promise<Song> {
    await this.taskQueue.queuing();
    try {
      if (!this.options.savePreviousSongs) throw new DisTubeError("DISABLED_OPTION", "savePreviousSongs");
      if (this.previousSongs?.length === 0 && this.repeatMode !== 2) throw new DisTubeError("NO_PREVIOUS");
      const song =
        this.repeatMode === 2 ? this.songs[this.songs.length - 1] : this.previousSongs[this.previousSongs.length - 1];
      this.prev = true;
      this.voice.stop();
      return song;
    } finally {
      this.taskQueue.resolve();
    }
  }
  /**
   * Shuffle the queue's songs
   * @returns {Promise<Queue>} The guild queue
   */
  async shuffle(): Promise<Queue> {
    await this.taskQueue.queuing();
    try {
      if (!this.songs.length) return this;
      const playing = this.songs.shift() as Song;
      for (let i = this.songs.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [this.songs[i], this.songs[j]] = [this.songs[j], this.songs[i]];
      }
      this.songs.unshift(playing);
      return this;
    } finally {
      this.taskQueue.resolve();
    }
  }
  /**
   * Jump to the song position in the queue.
   * The next one is 1, 2,...
   * The previous one is -1, -2,...
   * @param {number} position The song position to play
   * @returns {Promise<Queue>} The guild queue
   * @throws {Error} if `num` is invalid number
   */
  async jump(position: number): Promise<Queue> {
    await this.taskQueue.queuing();
    try {
      if (typeof position !== "number") throw new DisTubeError("INVALID_TYPE", "number", position, "position");
      if (!position || position > this.songs.length || -position > this.previousSongs.length) {
        throw new DisTubeError("NO_SONG_POSITION");
      }
      if (position > 0) {
        const nextSongs = this.songs.splice(position - 1);
        if (this.options.savePreviousSongs) {
          this.previousSongs.push(...this.songs);
        } else {
          this.previousSongs.push(
            ...this.songs.map(s => {
              return { id: s.id } as Song;
            }),
          );
        }
        this.songs = nextSongs;
        this.next = true;
      } else if (!this.options.savePreviousSongs) {
        throw new DisTubeError("DISABLED_OPTION", "savePreviousSongs");
      } else {
        this.prev = true;
        if (position !== -1) this.songs.unshift(...this.previousSongs.splice(position + 1));
      }
      this.voice.stop();
      return this;
    } finally {
      this.taskQueue.resolve();
    }
  }
  /**
   * Set the repeat mode of the guild queue.
   * Turn off if repeat mode is the same value as new mode.
   * Toggle mode `(0 -> 1 -> 2 -> 0...)`: `mode` is `undefined`
   * @param {number?} [mode] The repeat modes `(0: disabled, 1: Repeat a song, 2: Repeat all the queue)`
   * @returns {number} The new repeat mode
   */
  setRepeatMode(mode?: number): number {
    if (mode !== undefined && ![0, 1, 2].includes(mode)) {
      throw new DisTubeError("INVALID_TYPE", [0, 1, 2, "undefined"], mode, "mode");
    }
    if (mode === undefined) this.repeatMode = (this.repeatMode + 1) % 3;
    else if (this.repeatMode === mode) this.repeatMode = 0;
    else this.repeatMode = mode;
    return this.repeatMode;
  }
  /**
   * Enable or disable filter(s) of the queue.
   * Available filters: {@link Filters}
   * @param {string|string[]|false} filter A filter name, an array of filter name or `false` to clear all the filters
   * @param {boolean} [force=false] Force enable the input filter(s) even if it's enabled
   * @returns {Array<string>} Enabled filters.
   * @throws {Error}
   */
  setFilter(filter: string | string[] | false, force = false): Array<string> {
    if (Array.isArray(filter)) {
      filter = filter.filter(f => Object.prototype.hasOwnProperty.call(this.distube.filters, f));
      if (!filter.length) throw new DisTubeError("EMPTY_FILTERED_ARRAY", "filter", "filter name");
      for (const f of filter) {
        if (this.filters.includes(f)) {
          if (!force) this.filters.splice(this.filters.indexOf(f), 1);
        } else {
          this.filters.push(f);
        }
      }
    } else if (filter === false) {
      this.filters = [];
    } else if (!Object.prototype.hasOwnProperty.call(this.distube.filters, filter)) {
      throw new DisTubeError("INVALID_TYPE", "filter name", filter, "filter");
    } else if (this.filters.includes(filter)) {
      if (!force) this.filters.splice(this.filters.indexOf(filter), 1);
    } else {
      this.filters.push(filter);
    }
    this.beginTime = this.currentTime;
    this.queues.playSong(this);
    return this.filters;
  }
  /**
   * Set the playing time to another position
   * @param {number} time Time in seconds
   * @returns {Queue} The guild queue
   */
  seek(time: number): Queue {
    if (typeof time !== "number") throw new DisTubeError("INVALID_TYPE", "number", time, "time");
    if (isNaN(time) || time < 0) throw new DisTubeError("NUMBER_COMPARE", "time", "bigger or equal to", 0);
    this.beginTime = time;
    this.queues.playSong(this);
    return this;
  }
  /**
   * Add a related song of the playing song to the queue
   * @returns {Promise<Song>} The added song
   * @throws {Error}
   */
  async addRelatedSong(): Promise<Song> {
    if (!this.songs?.[0]) throw new DisTubeError("NO_PLAYING");
    const related = this.songs[0].related.find(v => !this.previousSongs.map(s => s.id).includes(v.id));
    if (!related || !(related instanceof Song)) throw new DisTubeError("NO_RELATED");
    const song = await this.handler.resolveSong(this.clientMember, related.url);
    if (!(song instanceof Song)) throw new DisTubeError("CANNOT_PLAY_RELATED");
    this.addToQueue(song);
    return song;
  }
  /**
   * Stop the guild stream
   */
  async stop() {
    await this.taskQueue.queuing();
    try {
      this.stopped = true;
      this.voice.stop();
      if (this.options.leaveOnStop) this.voice.leave();
      this.delete();
    } finally {
      this.taskQueue.resolve();
    }
  }
  /**
   * Delete the queue from the manager
   * (This does not leave the queue even if {@link DisTubeOptions|DisTubeOptions.leaveOnStop} is enabled)
   * @private
   */
  delete() {
    this.stopped = true;
    this.songs = [];
    this.previousSongs = [];
    if (this.listeners) {
      for (const event of Object.keys(this.listeners) as (keyof DisTubeVoiceEvents)[]) {
        this.voice.removeListener(event, this.listeners[event]);
      }
    }
    this.queues.delete(this.id);
    this.emit("deleteQueue", this);
  }
  /**
   * Toggle autoplay mode
   * @returns {boolean} Autoplay mode state
   */
  toggleAutoplay(): boolean {
    this.autoplay = !this.autoplay;
    return this.autoplay;
  }
}

export default Queue;
