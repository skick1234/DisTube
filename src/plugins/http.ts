import { ExtractorPlugin, Song } from "../struct";
import http from "http";
import { URL } from "url";
import { GuildMember } from "discord.js";

const getResponseHeaders = (url: string | URL | http.RequestOptions) =>
  new Promise((resolve, reject) => {
    http
      .get(url)
      .on("response", res => resolve(res.headers))
      .on("error", reject);
  });

export class HTTPPlugin extends ExtractorPlugin {
  async validate(url: string) {
    if (new URL(url).protocol.toLowerCase() !== "http:") {
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
      "http",
    );
  }
}

export default HTTPPlugin;
