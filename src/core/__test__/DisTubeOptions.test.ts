import { Options, defaultOptions } from "../..";

test("Default DisTubeOptions", () => {
  expect(new Options({})).toEqual({
    customFilters: {},
    emitNewSongOnly: false,
    emptyCooldown: 60,
    leaveOnEmpty: true,
    leaveOnFinish: false,
    leaveOnStop: true,
    nsfw: false,
    plugins: [],
    savePreviousSongs: true,
    searchCooldown: 60,
    searchSongs: 0,
    updateYouTubeDL: true,
    youtubeCookie: undefined,
    youtubeDL: true,
    youtubeIdentityToken: undefined,
    ytdlOptions: {
      highWaterMark: 16777216,
    },
    emitAddListWhenCreatingQueue: true,
    emitAddSongWhenCreatingQueue: true,
  });
});

test("Validate DisTubeOptions", () => {
  const n: any = NaN;
  for (const key of Object.keys(defaultOptions).filter(o => o !== "plugins")) {
    const options = {};
    options[key] = n;
    expect(() => {
      new Options(options);
    }).toThrow(`Expected '${typeof defaultOptions[key]}' for 'DisTubeOptions.${key}', but got NaN`);
  }
  expect(() => {
    new Options({ plugins: "undefined" as any });
  }).toThrow("Expected 'Array<Plugin>' for 'DisTubeOptions.plugins', but got 'undefined'");
  expect(() => {
    new Options({ youtubeCookie: 1 as any });
  }).toThrow("Expected 'string' for 'DisTubeOptions.youtubeCookie', but got 1");
  expect(() => {
    new Options({ youtubeIdentityToken: {} as any });
  }).toThrow("Expected 'string' for 'DisTubeOptions.youtubeIdentityToken', but got Object");
});
