import { StreamType } from "@discordjs/voice";
import { liveFormats, regularFormats } from "./raw/videoFormats";
import { DisTubeError, DisTubeStream, chooseBestVideoFormat } from "../..";

import { FFmpeg as _FFmpeg } from "prism-media";

jest.mock("prism-media");

const FFmpeg = _FFmpeg as unknown as jest.Mocked<typeof _FFmpeg>;

const regularItag = 251;
const liveItag = 91;

afterEach(() => {
  jest.resetAllMocks();
});

describe("chooseBestVideoFormat()", () => {
  test("Regular video", () => {
    expect(chooseBestVideoFormat(regularFormats)).toMatchObject({ itag: regularItag });
  });

  test("Live video", () => {
    expect(chooseBestVideoFormat(liveFormats as any, true)).toMatchObject({ itag: liveItag });
    // Non-HLS live is not supported
    expect(liveFormats.find(f => f.itag === liveItag).isHLS).toBe(true);
  });
});

describe("DisTubeStream.YouTube()", () => {
  test("Regular video", () => {
    const stream = DisTubeStream.YouTube(regularFormats, { ffmpegArgs: ["added", "arguments"] });
    const url = regularFormats.find(f => f.itag === regularItag).url;
    expect(stream).toMatchObject({
      url,
      type: StreamType.Raw,
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
          "added",
          "arguments",
        ]),
      }),
    );
  });

  test("Live video", () => {
    const stream = DisTubeStream.YouTube(liveFormats as any, { seek: 1, isLive: true });
    const url = liveFormats.find(f => f.itag === liveItag).url;
    expect(stream).toMatchObject({
      url,
      type: StreamType.Raw,
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
        ]),
      }),
    );
  });

  test("Should not return a DisTubeStream", () => {
    expect(() => {
      DisTubeStream.YouTube([]);
    }).toThrow(new DisTubeError("UNAVAILABLE_VIDEO"));
    expect(() => {
      DisTubeStream.YouTube([{}] as any, 0 as any);
    }).toThrow(new DisTubeError("INVALID_TYPE", "object", 0, "options"));
    expect(() => {
      DisTubeStream.YouTube([{}] as any, [] as any);
    }).toThrow(new DisTubeError("INVALID_TYPE", "object", [], "options"));
    expect(() => {
      DisTubeStream.YouTube([{}] as any);
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
      type: StreamType.Raw,
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
