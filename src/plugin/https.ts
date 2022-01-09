import https from "https";
import ExtractorPlugin from "../struct/ExtractorPlugin";
import { URL } from "url";
import { Song } from "..";
import type http from "http";
import type { GuildMember } from "discord.js";

export const getResponseHeaders = async (
  httpModule: typeof http | typeof https,
  url: string,
): Promise<http.IncomingHttpHeaders> =>
  new Promise((resolve, reject) => {
    httpModule
      .get(url)
      .on("response", res => {
        resolve(res.headers);
      })
      .on("error", reject);
  });

export const validateAudioURL = async (httpModule: typeof http | typeof https, protocol: string, url: string) => {
  if (new URL(url).protocol.toLowerCase() !== protocol) {
    return false;
  }
  const headers = await getResponseHeaders(httpModule, url),
    type = headers["content-type"];
  if (type?.startsWith("audio")) {
    return true;
  }
  return false;
};

// eslint-disable-next-line @typescript-eslint/require-await
export const resolveHttpSong = async (source: string, url: string, member: GuildMember, metadata: any) => {
  url = url.replace(/\/+$/, "");
  return new Song(
    {
      name: url.substring(url.lastIndexOf("/") + 1).replace(/((\?|#).*)?$/, "") || url,
      url,
    },
    member,
    source,
    metadata,
  );
};

export class HTTPSPlugin extends ExtractorPlugin {
  async validate(url: string) {
    return validateAudioURL(https, "https:", url);
  }

  async resolve(url: string, member: GuildMember, metadata: any) {
    return resolveHttpSong("https", url, member, metadata);
  }
}

export default HTTPSPlugin;
