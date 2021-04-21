const { ExtractorPlugin, Song } = require("../DisTube");
const https = require("https");
const { URL } = require("url");
const getResponseHeaders = url => new Promise((resolve, reject) => {
  https.get(url)
    .on("response", res => resolve(res.headers))
    .on("error", reject);
});

class HTTPSPlugin extends ExtractorPlugin {
  async validate(url) {
    if (new URL(url).protocol.toLowerCase() !== "https:") return false;
    const headers = await getResponseHeaders(url);
    const type = headers["content-type"];
    if (type.startsWith("audio")) return true;
    return false;
  }
  resolve(url, member) {
    url = url.replace(/\/+$/, "");
    return new Song({
      name: url.substring(url.lastIndexOf("/") + 1).replace(/((\?|#).*)?$/, ""),
      url,
    }, member, "https");
  }
}

module.exports = HTTPSPlugin;
