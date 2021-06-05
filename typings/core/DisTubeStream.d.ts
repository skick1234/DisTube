export = DisTubeStream;
declare class DisTubeStream {
    /**
     * Create a stream from ytdl info
     * @param {ytdl.videoInfo} info ytdl full info
     * @param {StreamOptions} options options
     * @returns {Transform}
     */
    static YouTube(info: ytdl.videoInfo, options?: StreamOptions): Transform;
    /**
     * Create a stream from a stream url
     * @param {string} url stream url
     * @param {StreamOptions} options options
     * @returns {Transform}
     */
    static DirectLink(url: string, options?: StreamOptions): Transform;
}
declare namespace DisTubeStream {
    export { StreamOptions };
}
import ytdl = require("ytdl-core");
type StreamOptions = {
    /**
     * Time to seek in milliseconds
     */
    seek: number;
    /**
     * Additional FFmpeg arguments
     */
    FFmpegArgs: string[];
};
import { Transform } from "stream";
