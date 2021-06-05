const { ExtractorPlugin, Song, Playlist } = require("../DisTube"),
  youtube_dl = require("@distube/youtube-dl");

class YouTubeDLPlugin extends ExtractorPlugin {
  constructor(updateYouTubeDL = true) {
    super();
    if (updateYouTubeDL) {
      require("@distube/youtube-dl/src/download")()
        .then(version => console.log(`[DisTube] Updated youtube-dl to ${version}!`))
        .catch(console.error)
        .catch(() => console.log("[DisTube] Unable to update youtube-dl, using default version."));
    }
  }
  validate() {
    return true;
  }
  async resolve(url, member) {
    const info = await youtube_dl(url, {
      dumpSingleJson: true,
      noWarnings: true,
      noCallHome: true,
      preferFreeFormats: true,
    }).catch(e => { throw new Error(`[youtube-dl] ${e.stderr || e}`) });
    if (Array.isArray(info.entries) && info.entries.length > 0) {
      info.source = info.extractor.match(/\w+/)[0];
      info.songs = info.entries.map(i => new Song(i, member, i.extractor));
      return new Playlist(info, member);
    }
    return new Song(info, member, info.extractor);
  }
  async getStreamURL(url) {
    const info = await youtube_dl(url, {
      dumpSingleJson: true,
      noWarnings: true,
      noCallHome: true,
      preferFreeFormats: true,
    }).catch(e => { throw new Error(`[youtube-dl] ${e.stderr || e}`) });
    return info.url;
  }
}

module.exports = YouTubeDLPlugin;
