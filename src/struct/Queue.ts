import { DisTubeBase, FilterManager } from "../core";
import { DisTubeError, Events, RepeatMode, Song, TaskQueue, formatDuration, objectKeys } from "..";
import type { GuildTextBasedChannel, Snowflake } from "discord.js";
import type { DisTube, DisTubeVoice, DisTubeVoiceEvents } from "..";

/**
 * Represents a queue.
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
  _taskQueue: TaskQueue;
  _listeners?: DisTubeVoiceEvents;
  /**
   * Create a queue for the guild
   *
   * @param distube     - DisTube
   * @param voice       - Voice connection
   * @param song        - First song(s)
   * @param textChannel - Default text channel
   */
  constructor(distube: DisTube, voice: DisTubeVoice, song: Song | Song[], textChannel?: GuildTextBasedChannel) {
    super(distube);
    /**
     * Voice connection of this queue.
     */
    this.voice = voice;
    /**
     * Queue id (Guild id)
     */
    this.id = voice.id;
    /**
     * Get or set the stream volume. Default value: `50`.
     */
    this.volume = 50;
    /**
     * List of songs in the queue (The first one is the playing song)
     */
    this.songs = Array.isArray(song) ? [...song] : [song];
    /**
     * List of the previous songs.
     */
    this.previousSongs = [];
    /**
     * Whether stream is currently stopped.
     */
    this.stopped = false;
    /**
     * Whether or not the last song was skipped to next song.
     */
    this._next = false;
    /**
     * Whether or not the last song was skipped to previous song.
     */
    this._prev = false;
    /**
     * Whether or not the stream is currently playing.
     */
    this.playing = true;
    /**
     * Whether or not the stream is currently paused.
     */
    this.paused = false;
    /**
     * Type of repeat mode (`0` is disabled, `1` is repeating a song, `2` is repeating
     * all the queue). Default value: `0` (disabled)
     */
    this.repeatMode = RepeatMode.DISABLED;
    /**
     * Whether or not the autoplay mode is enabled. Default value: `false`
     */
    this.autoplay = false;
    this.#filters = new FilterManager(this);
    /**
     * What time in the song to begin (in seconds).
     */
    this.beginTime = 0;
    /**
     * The text channel of the Queue. (Default: where the first command is called).
     */
    this.textChannel = textChannel;
    /**
     * Timeout for checking empty channel
     */
    this._emptyTimeout = undefined;
    /**
     * Task queuing system
     */
    this._taskQueue = new TaskQueue();
    /**
     * DisTubeVoice listener
     */
    this._listeners = undefined;
  }
  /**
   * The client user as a `GuildMember` of this queue's guild
   */
  get clientMember() {
    return this.voice.channel.guild.members.me ?? undefined;
  }
  /**
   * The filter manager of the queue
   */
  get filters() {
    return this.#filters;
  }
  /**
   * Formatted duration string.
   */
  get formattedDuration() {
    return formatDuration(this.duration);
  }
  /**
   * Queue's duration.
   */
  get duration() {
    return this.songs.length ? this.songs.reduce((prev, next) => prev + next.duration, 0) : 0;
  }
  /**
   * What time in the song is playing (in seconds).
   */
  get currentTime() {
    return this.voice.playbackDuration + this.beginTime;
  }
  /**
   * Formatted {@link Queue#currentTime} string.
   */
  get formattedCurrentTime() {
    return formatDuration(this.currentTime);
  }
  /**
   * The voice channel playing in.
   */
  get voiceChannel() {
    return this.clientMember?.voice?.channel ?? null;
  }
  get volume() {
    return this.voice.volume;
  }
  set volume(value: number) {
    this.voice.volume = value;
  }
  /**
   * @throws {DisTubeError}
   *
   * @param song     - Song to add
   * @param position - Position to add, \<= 0 to add to the end of the queue
   *
   * @returns The guild queue
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
    if (Array.isArray(song)) song.forEach(s => delete s.formats);
    else delete song.formats;
    return this;
  }
  /**
   * Pause the guild stream
   *
   * @returns The guild queue
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
   *
   * @returns The guild queue
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
   *
   * @param percent - The percentage of volume you want to set
   *
   * @returns The guild queue
   */
  setVolume(percent: number): Queue {
    this.volume = percent;
    return this;
  }

  /**
   * Skip the playing song if there is a next song in the queue. <info>If {@link
   * Queue#autoplay} is `true` and there is no up next song, DisTube will add and
   * play a related song.</info>
   *
   * @returns The song will skip to
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
   *
   * @returns The guild queue
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
   *
   * @returns The guild queue
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
   * Jump to the song position in the queue. The next one is 1, 2,... The previous
   * one is -1, -2,...
   * if `num` is invalid number
   *
   * @param position - The song position to play
   *
   * @returns The new Song will be played
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
          this.previousSongs.push(...this.songs.map(s => ({ id: s.id }) as Song));
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
   * Set the repeat mode of the guild queue.
   * Toggle mode `(Disabled -> Song -> Queue -> Disabled ->...)` if `mode` is `undefined`
   *
   * @param mode - The repeat modes (toggle if `undefined`)
   *
   * @returns The new repeat mode
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
   *
   * @param time - Time in seconds
   *
   * @returns The guild queue
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
   *
   * @returns The added song
   */
  async addRelatedSong(): Promise<Song> {
    if (!this.songs?.[0]) throw new DisTubeError("NO_PLAYING");
    const related = this.songs[0].related.find(v => !this.previousSongs.map(s => s.id).includes(v.id));
    if (!related || !(related instanceof Song)) throw new DisTubeError("NO_RELATED");
    const song = await this.handler.resolve(related, { member: this.clientMember, metadata: related.metadata });
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
   * Remove the queue from the manager (This does not leave the voice channel even if
   * {@link DisTubeOptions | DisTubeOptions.leaveOnStop} is enabled)
   */
  remove() {
    this.stopped = true;
    this.songs = [];
    this.previousSongs = [];
    if (this._listeners) {
      for (const event of objectKeys(this._listeners)) {
        this.voice.removeListener(event, this._listeners[event]);
      }
    }
    this.queues.remove(this.id);
    this.emit(Events.DELETE_QUEUE, this);
  }
  /**
   * Toggle autoplay mode
   *
   * @returns Autoplay mode state
   */
  toggleAutoplay(): boolean {
    this.autoplay = !this.autoplay;
    return this.autoplay;
  }
}
