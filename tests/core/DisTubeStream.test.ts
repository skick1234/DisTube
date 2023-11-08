import { StreamType as DiscordVoiceStreamType } from "@discordjs/voice";
import { liveFormats, regularFormats } from "../raw";
import { DisTubeError, DisTubeStream, StreamType, chooseBestVideoFormat } from "@";

import { FFmpeg as _FFmpeg } from "prism-media";

jest.mock("prism-media");

const FFmpeg = _FFmpeg as unknown as jest.Mocked<typeof _FFmpeg>;

const regularItag = 251;
const liveItag = 95;
const longItag = 18;

afterEach(() => {
  jest.resetAllMocks();
});

describe("chooseBestVideoFormat()", () => {
  test("Regular video", () => {
    expect(chooseBestVideoFormat(<any>{ formats: regularFormats, isLive: false, duration: 60 })).toMatchObject({
      itag: regularItag,
    });
  });

  test("Live video", () => {
    expect(chooseBestVideoFormat(<any>{ formats: liveFormats, isLive: true, duration: 0 })).toMatchObject({
      itag: liveItag,
      isHLS: true,
    });
  });

  test("Long video", () => {
    expect(chooseBestVideoFormat(<any>{ formats: regularFormats, isLive: false, duration: 15 * 60 })).toMatchObject({
      itag: longItag,
    });
  });
});

describe("DisTubeStream.YouTube()", () => {
  test("Regular video", () => {
    const stream = DisTubeStream.YouTube(
      <any>{ source: "youtube", formats: regularFormats, isLive: false, duration: 60 },
      {
        ffmpegArgs: ["added", "arguments"],
        type: StreamType.RAW,
      },
    );
    const url = regularFormats.find(f => f.itag === regularItag).url;
    expect(stream).toMatchObject({
      url,
      type: DiscordVoiceStreamType.Raw,
      stream: expect.any(FFmpeg),
    });
    expect(FFmpeg).toBeCalledWith(
      expect.objectContaining({
        args: expect.arrayContaining([
          "-reconnect",
          "1",
          "-reconnect_streamed",
          "1",
          "-reconnect_delay_max",
          "5",
          "-i",
          url,
          "-analyzeduration",
          "0",
          "-loglevel",
          "0",
          "-ar",
          "48000",
          "-ac",
          "2",
          "-f",
          "s16le",
          "added",
          "arguments",
        ]),
      }),
    );
  });

  test("Live video", () => {
    const stream = DisTubeStream.YouTube(<any>{ source: "youtube", formats: liveFormats, isLive: true, duration: 60 }, {
      seek: 1,
    });
    const url = liveFormats.find(f => f.itag === liveItag).url;
    expect(stream).toMatchObject({
      url,
      type: DiscordVoiceStreamType.OggOpus,
      stream: expect.any(FFmpeg),
    });
    expect(FFmpeg).toBeCalledWith(
      expect.objectContaining({
        args: expect.arrayContaining([
          "-reconnect",
          "1",
          "-reconnect_streamed",
          "1",
          "-reconnect_delay_max",
          "5",
          "-i",
          url,
          "-analyzeduration",
          "0",
          "-loglevel",
          "0",
          "-ar",
          "48000",
          "-ac",
          "2",
          "-ss",
          "1",
          "-f",
          "opus",
          "-acodec",
          "libopus",
        ]),
      }),
    );
  });

  test("Should not return a DisTubeStream", () => {
    const s: any = { source: "test" };
    expect(() => {
      DisTubeStream.YouTube(s);
    }).toThrow(new DisTubeError("INVALID_TYPE", "youtube", s.source, "Song#source"));
    expect(() => {
      DisTubeStream.YouTube(<any>{ source: "youtube" });
    }).toThrow(new DisTubeError("UNAVAILABLE_VIDEO"));
    expect(() => {
      DisTubeStream.YouTube(<any>{ source: "youtube", formats: [{}] }, 0 as any);
    }).toThrow(new DisTubeError("INVALID_TYPE", "object", 0, "options"));
    expect(() => {
      DisTubeStream.YouTube(<any>{ source: "youtube", formats: [{}] }, [] as any);
    }).toThrow(new DisTubeError("INVALID_TYPE", "object", [], "options"));
    expect(() => {
      DisTubeStream.YouTube(<any>{ source: "youtube", formats: [{}] });
    }).toThrow(new DisTubeError("UNPLAYABLE_FORMATS"));
    expect(FFmpeg).not.toBeCalled();
  });
});

describe("DisTubeStream.DirectLink()", () => {
  test("Valid URL", () => {
    const url = "https://distube.js.org";
    const stream = DisTubeStream.DirectLink(url);
    expect(stream).toMatchObject({
      url,
      type: DiscordVoiceStreamType.OggOpus,
      stream: expect.any(FFmpeg),
    });
    expect(FFmpeg).toBeCalledWith(
      expect.objectContaining({
        args: expect.arrayContaining([
          "-reconnect",
          "1",
          "-reconnect_streamed",
          "1",
          "-reconnect_delay_max",
          "5",
          "-i",
          url,
          "-analyzeduration",
          "0",
          "-loglevel",
          "0",
          "-ar",
          "48000",
          "-ac",
          "2",
          "-f",
          "opus",
          "-acodec",
          "libopus",
        ]),
      }),
    );
  });

  test("Should not return a DisTubeStream", () => {
    expect(() => {
      DisTubeStream.DirectLink("", 0 as any);
    }).toThrow(new DisTubeError("INVALID_TYPE", "object", 0, "options"));
    expect(() => {
      DisTubeStream.DirectLink("", [] as any);
    }).toThrow(new DisTubeError("INVALID_TYPE", "object", [], "options"));
    expect(() => {
      DisTubeStream.DirectLink("not an url");
    }).toThrow(new DisTubeError("INVALID_TYPE", "an URL", "not an url"));
    expect(FFmpeg).not.toBeCalled();
  });
});
