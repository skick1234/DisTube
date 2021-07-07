import { ExtractorPlugin, Song } from "../struct";
import https from "https";
import { URL } from "url";
import { GuildMember } from "discord.js";
const getResponseHeaders = (url: string | https.RequestOptions | URL) =>
  new Promise((resolve, reject) => {
    https
      .get(url)
      .on("response", res => resolve(res.headers))
      .on("error", reject);
  });

export class HTTPSPlugin extends ExtractorPlugin {
  async validate(url: string) {
    if (new URL(url).protocol.toLowerCase() !== "https:") {
      return false;
    }
    const headers = (await getResponseHeaders(url)) as any;
    const type = headers["content-type"];
    if (type.startsWith("audio")) {
      return true;
    }
    return false;
  }
  // eslint-disable-next-line require-await
  async resolve(url: string, member: GuildMember) {
    url = url.replace(/\/+$/, "");
    return new Song(
      {
        name: url.substring(url.lastIndexOf("/") + 1).replace(/((\?|#).*)?$/, "") || url,
        url,
      },
      member,
      "https",
    );
  }
}

export default HTTPSPlugin;
