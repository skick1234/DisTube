import { liveFormats, regularFormats } from "../raw";
import { chooseBestVideoFormat } from "@";

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

test.todo("DisTubeStream"); // Do after v5 refactoring
