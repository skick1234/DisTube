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
    ytdlOptions: {},
    emitAddListWhenCreatingQueue: true,
    emitAddSongWhenCreatingQueue: true,
  });
});

test("Validate DisTubeOptions", () => {
  const n: any = NaN;
  expect(() => {
    new Options(n);
  }).toThrow("Expected 'object' for 'DisTubeOptions', but got null (Number)");
  for (const key of Object.keys(defaultOptions).filter(o => o !== "plugins")) {
    const options = {};
    options[key] = n;
    expect(() => {
      new Options(options);
    }).toThrow(`Expected '${typeof defaultOptions[key]}' for 'DisTubeOptions.${key}', but got null (Number)`);
  }
  expect(() => {
    new Options({ plugins: "undefined" as any });
  }).toThrow("Expected 'Array<Plugin>' for 'DisTubeOptions.plugins', but got \"undefined\" (String)");
  expect(() => {
    new Options({ youtubeCookie: 1 as any });
  }).toThrow("Expected 'string' for 'DisTubeOptions.youtubeCookie', but got 1 (Number)");
  expect(() => {
    new Options({ youtubeIdentityToken: {} as any });
  }).toThrow("Expected 'string' for 'DisTubeOptions.youtubeIdentityToken', but got {} (Object)");
  expect(() => {
    new Options({ invalidKey: "an invalid key" } as any);
  }).toThrow("'invalidKey' does not need to be provided in DisTubeOptions");
});
