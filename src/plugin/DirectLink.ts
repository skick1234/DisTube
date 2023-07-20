import { request } from "undici";
import { ExtractorPlugin, Song } from "..";
import type { GuildMember } from "discord.js";

export class DirectLinkPlugin extends ExtractorPlugin {
  override async validate(url: string) {
    try {
      const headers = await request(url, { method: "HEAD" }).then(res => res.headers);
      const types = headers["content-type"];
      const type = Array.isArray(types) ? types[0] : types;
      if (["audio/", "video/", "application/ogg"].some(s => type?.startsWith(s))) return true;
    } catch {}
    return false;
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async resolve(url: string, options: { member?: GuildMember; metadata?: any } = {}) {
    url = url.replace(/\/+$/, "");
    return new Song(
      {
        name: url.substring(url.lastIndexOf("/") + 1).replace(/((\?|#).*)?$/, "") || url,
        url,
        src: "direct_link",
      },
      options,
    );
  }
}
