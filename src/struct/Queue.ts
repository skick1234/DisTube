import { DisTubeBase, FilterManager } from "../core";
import { DisTubeError, RepeatMode, Song, TaskQueue, formatDuration } from "..";
import type { DisTube, DisTubeVoice, DisTubeVoiceEvents } from "..";
import type { GuildMember, GuildTextBasedChannel, Snowflake } from "discord.js";

/**
 * Represents a queue.
 * @extends DisTubeBase
 */
export class Queue extends DisTubeBase {
  readonly id: Snowflake;
  voice: DisTubeVoice;
  songs: Song[];
  previousSongs: Song[];
  stopped: boolean;
  _next: boolean;
  _prev: boolean;
  playing: boolean;
  paused: boolean;
  repeatMode: RepeatMode;
  autoplay: boolean;
  #filters: FilterManager;
  beginTime: number;
  textChannel?: GuildTextBasedChannel;
  _emptyTimeout?: NodeJS.Timeout;
  clientMember: GuildMember;
  _taskQueue: TaskQueue;
  _listeners?: DisTubeVoiceEvents;
  /**
   * Create a queue for the guild
   * @param {DisTube} distube DisTube
   * @param {DisTubeVoice} voice Voice connection
   * @param {Song|Song[]} song First song(s)
   * @param {Discord.BaseGuildTextChannel?} textChannel Default text channel
   */
  constructor(distube: DisTube, voice: DisTubeVoice, song: Song | Song[], textChannel?: GuildTextBasedChannel) {
    super(distube);
    /**
     * The client user as a `GuildMember` of this queue's guild
     * @type {Discord.GuildMember}
     */
    this.clientMember =
      voice.channel.guild?.me ??
      (() => {
        throw new DisTubeError("INVALID_TYPE", "GuildMember", null, "<VoiceChannel>.guild.me");
      })();
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
    this._next = false;
    /**
     * Whether or not the last song was skipped to previous song.
     * @type {boolean}
     * @private
     */
    this._prev = false;
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
     * @type {RepeatMode}
     */
    this.repeatMode = RepeatMode.DISABLED;
    /**
     * Whether or not the autoplay mode is enabled.
     * Default value: `false`
     * @type {boolean}
     */
    this.autoplay = false;
    this.#filters = new FilterManager(distube, this);
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
    this._emptyTimeout = undefined;
    /**
     * Task queuing system
     * @type {TaskQueue}
     * @private
     */
    this._taskQueue = new TaskQueue();
    /**
     * DisTubeVoice listener
     * @type {Object}
     * @private
     */
    this._listeners = undefined;
  }
  /**
   * The filter manager of the queue
   * @type {FilterManager}
   * @readonly
   */
  get filters() {
    return this.#filters;
  }
  /**
   * Formatted duration string.
   * @type {string}
   * @readonly
   */
  get formattedDuration() {
    return formatDuration(this.duration);
  }
  /**
   * Queue's duration.
   * @type {number}
   * @readonly
   */
  get duration() {
    return this.songs.length ? this.songs.reduce((prev, next) => prev + next.duration, 0) : 0;
  }
  /**
   * What time in the song is playing (in seconds).
   * @type {number}
   * @readonly
   */
  get currentTime() {
    return this.voice.playbackDuration + this.beginTime;
  }
  /**
   * Formatted {@link Queue#currentTime} string.
   * @type {string}
   * @readonly
   */
  get formattedCurrentTime() {
    return formatDuration(this.currentTime);
  }
  /**
   * The voice channel playing in.
   * @type {Discord.VoiceChannel|Discord.StageChannel|null}
   * @readonly
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
   * @private
   * Add a Song or an array of Song to the queue
   * @param {Song|Song[]} song Song to add
   * @param {number} [position=0] Position to add, <= 0 to add to the end of the queue
   * @throws {Error}
   * @returns {Queue} The guild queue
   */
  addToQueue(song: Song | Song[], position = 0): Queue {
    if (!song || (Array.isArray(song) && !song.length)) {
      throw new DisTubeError("INVALID_TYPE", ["Song", "Array<Song>"], song, "song");
    }
    if (typeof position !== "number" || !Number.isInteger(position)) {
      throw new DisTubeError("INVALID_TYPE", "integer", position, "position");
    }
    if (position <= 0) {
      if (Array.isArray(song)) this.songs.push(...song);
      else this.songs.push(song);
    } else if (Array.isArray(song)) {
      this.songs.splice(position, 0, ...song);
    } else {
      this.songs.splice(position, 0, song);
    }
    if (Array.isArray(song)) song.map(s => delete s.formats);
    else delete song.formats;
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
   * Skip the playing song if there is a next song in the queue.
   * <info>If {@link Queue#autoplay} is `true` and there is no up next song,
   * DisTube will add and play a related song.</info>
   * @returns {Promise<Song>} The song will skip to
   * @throws {Error}
   */
  async skip(): Promise<Song> {
    await this._taskQueue.queuing();
    try {
      if (this.songs.length <= 1) {
        if (this.autoplay) await this.addRelatedSong();
        else throw new DisTubeError("NO_UP_NEXT");
      }
      const song = this.songs[1];
      this._next = true;
      this.voice.stop();
      return song;
    } finally {
      this._taskQueue.resolve();
    }
  }

  /**
   * Play the previous song if exists
   * @returns {Song} The guild queue
   * @throws {Error}
   */
  async previous(): Promise<Song> {
    await this._taskQueue.queuing();
    try {
      if (!this.options.savePreviousSongs) throw new DisTubeError("DISABLED_OPTION", "savePreviousSongs");
      if (this.previousSongs?.length === 0 && this.repeatMode !== RepeatMode.QUEUE) {
        throw new DisTubeError("NO_PREVIOUS");
      }
      const song =
        this.repeatMode === 2 ? this.songs[this.songs.length - 1] : this.previousSongs[this.previousSongs.length - 1];
      this._prev = true;
      this.voice.stop();
      return song;
    } finally {
      this._taskQueue.resolve();
    }
  }
  /**
   * Shuffle the queue's songs
   * @returns {Promise<Queue>} The guild queue
   */
  async shuffle(): Promise<Queue> {
    await this._taskQueue.queuing();
    try {
      const playing = this.songs.shift();
      if (playing === undefined) return this;
      for (let i = this.songs.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [this.songs[i], this.songs[j]] = [this.songs[j], this.songs[i]];
      }
      this.songs.unshift(playing);
      return this;
    } finally {
      this._taskQueue.resolve();
    }
  }
  /**
   * Jump to the song position in the queue.
   * The next one is 1, 2,...
   * The previous one is -1, -2,...
   * @param {number} position The song position to play
   * @returns {Promise<Song>} The new Song will be played
   * @throws {Error} if `num` is invalid number
   */
  async jump(position: number): Promise<Song> {
    await this._taskQueue.queuing();
    try {
      if (typeof position !== "number") throw new DisTubeError("INVALID_TYPE", "number", position, "position");
      if (!position || position > this.songs.length || -position > this.previousSongs.length) {
        throw new DisTubeError("NO_SONG_POSITION");
      }
      let nextSong: Song;
      if (position > 0) {
        const nextSongs = this.songs.splice(position - 1);
        if (this.options.savePreviousSongs) {
          this.previousSongs.push(...this.songs);
        } else {
          this.previousSongs.push(...this.songs.map(s => ({ id: s.id } as Song)));
        }
        this.songs = nextSongs;
        this._next = true;
        nextSong = nextSongs[1];
      } else if (!this.options.savePreviousSongs) {
        throw new DisTubeError("DISABLED_OPTION", "savePreviousSongs");
      } else {
        this._prev = true;
        if (position !== -1) this.songs.unshift(...this.previousSongs.splice(position + 1));
        nextSong = this.previousSongs[this.previousSongs.length - 1];
      }
      this.voice.stop();
      return nextSong;
    } finally {
      this._taskQueue.resolve();
    }
  }
  /**
   * Set the repeat mode of the guild queue.\
   * Toggle mode `(Disabled -> Song -> Queue -> Disabled ->...)` if `mode` is `undefined`
   * @param {RepeatMode?} [mode] The repeat modes (toggle if `undefined`)
   * @returns {RepeatMode} The new repeat mode
   */
  setRepeatMode(mode?: RepeatMode): RepeatMode {
    if (mode !== undefined && !Object.values(RepeatMode).includes(mode)) {
      throw new DisTubeError("INVALID_TYPE", ["RepeatMode", "undefined"], mode, "mode");
    }
    if (mode === undefined) this.repeatMode = (this.repeatMode + 1) % 3;
    else if (this.repeatMode === mode) this.repeatMode = RepeatMode.DISABLED;
    else this.repeatMode = mode;
    return this.repeatMode;
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
    const song = await this.handler.resolveSong(related, { member: this.clientMember, metadata: related.metadata });
    if (!(song instanceof Song)) throw new DisTubeError("CANNOT_PLAY_RELATED");
    this.addToQueue(song);
    return song;
  }
  /**
   * Stop the guild stream and delete the queue
   */
  async stop() {
    await this._taskQueue.queuing();
    try {
      this.playing = false;
      this.paused = false;
      this.stopped = true;
      if (this.options.leaveOnStop) this.voice.leave();
      else this.voice.stop();
      this.remove();
    } finally {
      this._taskQueue.resolve();
    }
  }
  /**
   * Remove the queue from the manager
   * (This does not leave the voice channel even if {@link DisTubeOptions|DisTubeOptions.leaveOnStop} is enabled)
   * @private
   */
  remove() {
    this.stopped = true;
    this.songs = [];
    this.previousSongs = [];
    if (this._listeners) {
      for (const event of Object.keys(this._listeners) as (keyof DisTubeVoiceEvents)[]) {
        this.voice.removeListener(event, this._listeners[event]);
      }
    }
    this.queues.remove(this.id);
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
