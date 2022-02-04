import { Options, defaultOptions } from "../..";

test("Default DisTubeOptions", () => {
  expect(new Options({})).toEqual({
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
    youtubeCookie: undefined,
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
  }).toThrow("Expected 'object' for 'DisTubeOptions', but got NaN");
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
  }).toThrow("Expected 'string' for 'DisTubeOptions.youtubeIdentityToken', but got {}");
  expect(() => {
    new Options({ invalidKey: "an invalid key" } as any);
  }).toThrow("'invalidKey' does not need to be provided in DisTubeOptions");
});
