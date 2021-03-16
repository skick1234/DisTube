const ytdl = require("@distube/ytdl"),
  ytpl = require("@distube/ytpl"),
  Song = require("./Song"),
  SearchResult = require("./SearchResult"),
  Playlist = require("./Playlist"),
  { parseNumber, isURL } = require("./util"),
  youtube_dl = require("@distube/youtube-dl"),
  Base = require("./DisTubeBase"),
  // eslint-disable-next-line no-unused-vars
  Queue = require("./Queue"),
  // eslint-disable-next-line no-unused-vars
  { opus } = require("prism-media"),
  // eslint-disable-next-line no-unused-vars
  Discord = require("discord.js");


/**
 * DisTube's Handler
 * @private
 */
class DisTubeHandler extends Base {
  constructor(distube) {
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
  _emitError(channel, error) {
    this.distube.emit(channel, error);
  }

  /**
   * Delete a guild queue
   * @param {Discord.Snowflake|Discord.Message|Queue} queue The message from guild channel | Queue
   */
  deleteQueue(queue) {
    this.distube._deleteQueue(queue);
  }

  /**
   * @param {string} url url
   * @returns {Promise<ytdl.videoInfo>}
   */
  getYouTubeInfo(url) {
    return ytdl.getInfo(url, this.ytdlOptions);
  }

  /**
   * Resolve a Song
   * @async
   * @param {Discord.Message} message The message from guild channel
   * @param {string|Song} song Youtube url | Search string | {@link Song}
   * @returns {Promise<Song|Song[]>} Resolved Song
   */
  async resolveSong(message, song) {
    if (!song) return null;
    if (song instanceof Song) return song;
    if (song instanceof SearchResult) {
      if (song.type === "video") return new Song(await this.getYouTubeInfo(song.url), message.member);
      else if (song.type === "playlist") return this._resolvePlaylist(message, song.url);
      throw new Error("Invalid SearchResult");
    }
    if (typeof song === "object") return new Song(song, message.member);
    if (ytdl.validateURL(song)) return new Song(await this.getYouTubeInfo(song), message.member);
    if (isURL(song)) {
      if (!this.options.youtubeDL) throw new Error("Not Supported URL!");
      let info = await youtube_dl(song, {
        dumpJson: true,
        noWarnings: true,
      }).catch(e => { throw new Error(`[youtube-dl] ${e.stderr || e}`) });
      if (Array.isArray(info) && info.length > 0) return this.resolvePlaylist(message, info.map(i => new Song(i, message.member, i.extractor)));
      return new Song(info, message.member, info.extractor);
    }
    return this.resolveSong(message, await this.searchSong(message, song));
  }

  /**
   * Resole Song[] or url to a Playlist
   * @param {Discord.Message} message The message from guild channel
   * @param {Song[]|string} playlist Resolvable playlist
   * @returns {Playlist}
   */
  async resolvePlaylist(message, playlist) {
    if (typeof arg2 === "string") {
      playlist = await ytpl(playlist, { limit: Infinity });
      playlist.items = playlist.items.filter(v => !v.thumbnail.includes("no_thumbnail")).map(v => new Song(v, message.member));
    }
    if (!(playlist instanceof Playlist)) playlist = new Playlist(playlist, message.member);
    return playlist;
  }

  /**
   * Search for a song, fire {@link DisTube#event:error} if not found.
   * @async
   * @param {Discord.Message} message The message from guild channel
   * @param {string} name The string search for
   * @returns {Song} Song info
   */
  async searchSong(message, name) {
    let results;
    try {
      results = await this.distube.search(name, { limit: this.options.searchSongs || 1 });
    } catch {
      this.emit("searchNoResult", message);
      return null;
    }
    if (!results.length) {
      this.emit("searchNoResult", message);
      return null;
    }
    let result = results[0];
    if (this.options.searchSongs && this.options.searchSongs > 1) {
      this.emit("searchResult", message, results, name);
      let answers = await message.channel.awaitMessages(m => m.author.id === message.author.id, {
        max: 1,
        time: this.options.searchCooldown,
        errors: ["time"],
      });
      if (!answers.first()) {
        this.emit("searchCancel", message);
        return null;
      }
      let ans = answers.first();
      let index = parseInt(ans.content, 10);
      if (isNaN(index) || index > results.length || index < 1) {
        this.emit("searchCancel", message);
        return null;
      }
      this.emit("searchDone", message, ans);
      result = results[index - 1];
    }
    return result;
  }

  /**
   * Join the voice channel
   * @param {Queue} queue The message from guild channel
   * @param {Discord.VoiceChannel} voice The string search for
   * @param {boolean} retried retried?
   * @throws {Error} If an error encountered
   * @returns {Promise<Queue|true>}
   */
  async joinVoiceChannel(queue, voice, retried = false) {
    try {
      queue.connection = await voice.join();
      queue.connection.on("disconnect", () => {
        const guildID = queue.connection.channel.guild.id;
        try { queue.stop() } catch { this.deleteQueue(guildID) }
      }).on("error", e => {
        e.message = `There is a problem with Discord Voice Connection.\nReason: ${e.message}`;
        this.emitError(queue.channel, e);
        this.deleteQueue(queue);
      });
      const err = await this.playSong(queue);
      return err || queue;
    } catch (e) {
      this.deleteQueue(queue);
      e.message = `DisTube cannot join the voice channel!\nReason: ${e.message}`;
      if (retried) throw e;
      return this.joinVoiceChannel(queue, voice, true);
    }
  }

  /**
   * Get related songs
   * @async
   * @param {Song} song song
   * @returns {ytdl.relatedVideo[]} Related videos
   * @throws {NoRelated}
   */
  async getRelatedVideo(song) {
    if (!song.youtube) throw new Error("NoRelated");
    let related = song.related;
    if (!related) related = (await ytdl.getBasicInfo(song.url, this.ytdlOptions)).related_videos;
    if (!related || !related.length) throw new Error("NoRelated");
    return related;
  }

  /**
   * Create a ytdl stream
   * @param {Queue} queue Queue
   * @returns {opus.Encoder}
   */
  createStream(queue) {
    const song = queue.songs[0];
    const filterArgs = [];
    queue.filters.forEach(filter => filterArgs.push(this.distube.filters[filter]));
    const encoderArgs = queue.filters ? ["-af", filterArgs.join(",")] : null;
    let streamOptions = {
      opusEncoded: true,
      filter: song.isLive ? "audioandvideo" : "audioonly",
      quality: "highestaudio",
      encoderArgs,
      seek: queue.beginTime / 1000,
    };
    streamOptions = Object.assign(streamOptions, this.ytdlOptions);
    if (song.youtube) return ytdl(song.info, streamOptions);
    return ytdl.arbitraryStream(song.streamURL, streamOptions);
  }

  async checkYouTubeInfo(song) {
    if (!song.info) {
      let { videoDetails } = song.info = await this.getYouTubeInfo(song.url);
      song.views = parseNumber(videoDetails.viewCount);
      song.likes = parseNumber(videoDetails.likes);
      song.dislikes = parseNumber(videoDetails.dislikes);
      if (song.info.formats.length) {
        song.streamURL = ytdl.chooseFormat(song.info.formats, {
          filter: song.isLive ? "audioandvideo" : "audioonly",
          quality: "highestaudio",
        }).url;
      }
    }
    let err = require("ytdl-core/lib/utils").playError(song.info.player_response, ["UNPLAYABLE", "LIVE_STREAM_OFFLINE", "LOGIN_REQUIRED"]);
    if (err) throw err;
    if (!song.info.formats.length) throw new Error("This video is unavailable");
  }

  /**
   * Whether or not emit playSong event
   * @param {Queue} queue Queue
   * @private
   * @returns {boolean}
   */
  _emitPlaySong(queue) {
    if (
      !this.options.emitNewSongOnly ||
      (
        queue.repeatMode !== 1 &&
        (!queue.songs[1] || queue.songs[0].id !== queue.songs[1].id)
      )
    ) return true;
    return false;
  }

  /**
   * Play a song on voice connection
   * @param {Queue} queue The guild queue
   * @returns {boolean} error?
   */
  async playSong(queue) {
    if (!queue) return true;
    if (!queue.songs.length) {
      this.deleteQueue(queue);
      return true;
    }
    const song = queue.songs[0];
    try {
      let errorEmitted = false;
      if (song.youtube) await this.checkYouTubeInfo(song);
      const stream = this._createStream(queue).on("error", e => {
        errorEmitted = true;
        e.message = `${e.message}\nID: ${song.id}\nName: ${song.name}`;
        this._emitError(queue.textChannel, e);
      });
      queue.dispatcher = queue.connection.play(stream, {
        highWaterMark: 1,
        type: "opus",
        volume: queue.volume / 100,
        bitrate: "auto",
      }).on("finish", () => { this._handleSongFinish(queue) })
        .on("error", e => { this._handlePlayingError(queue, errorEmitted ? null : e) });
      if (queue.stream) queue.stream.destroy();
      queue.stream = stream;
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
   */
  async _handleSongFinish(queue) {
    if (queue.stopped) {
      this.deleteQueue(queue);
      return;
    }
    if (queue.repeatMode === 2 && !queue.next) queue.songs.push(queue.songs[0]);
    if (queue.songs.length <= 1 && (queue.next || !queue.repeatMode)) {
      if (queue.autoplay) await queue.addRelatedVideo();
      if (queue.songs.length <= 1) {
        if (this.options.leaveOnFinish) queue.connection.channel.leave();
        if (!queue.autoplay) this.emit("finish", queue.textChannel);
        this.deleteQueue(queue);
        return;
      }
    }
    if (queue.previous) queue.songs.unshift(queue.previousSongs.pop());
    else if (queue.repeatMode !== 1 && queue.next) {
      const prev = queue.songs.shift();
      if (this.options.savePreviousSongs) queue.previousSongs.push(prev);
    }
    queue.next = queue.previous = false;
    queue.beginTime = 0;
    const emitPlaySong = this._emitPlaySong(queue);
    let err = await this.playSong(queue);
    if (!err && emitPlaySong) this.emit("playSong", queue, queue.songs[0]);
  }

  /**
   * Handle error while playing
   * @private
   * @param {Queue} queue queue
   * @param {Error} error error
   */
  _handlePlayingError(queue, error = null) {
    let song = queue.songs.shift();
    if (error) {
      error.message = `${error.message}\nID: ${song.id}\nName: ${song.name}`;
      this._emitError(queue.textChannel, error);
    }
    if (queue.songs.length > 0) {
      this.playSong(queue).then(e => {
        if (!e) this.emit("playSong", queue, queue.songs[0]);
      });
    } else try { queue.stop() } catch { this.deleteQueue(queue) }
  }
}

module.exports = DisTubeHandler;
