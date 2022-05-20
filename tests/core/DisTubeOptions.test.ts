import { Options, defaultOptions } from "@";

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
    joinNewVoiceChannel: true,
    streamType: 0,
  });
});

const typeOfOption = (option: string) => {
  switch (option) {
    case "streamType":
      return "StreamType";
    case "plugins":
      return "Array<Plugin>";
    default:
      return typeof defaultOptions[option];
  }
};

test("Validate DisTubeOptions", () => {
  const n: any = NaN;
  expect(() => {
    new Options(n);
  }).toThrow("Expected 'object' for 'DisTubeOptions', but got NaN");
  for (const option of Object.keys(defaultOptions)) {
    const options = {};
    options[option] = n;
    expect(() => {
      new Options(options);
    }).toThrow(`Expected '${typeOfOption(option)}' for 'DisTubeOptions.${option}', but got NaN`);
  }
  expect(() => {
    new Options({ youtubeCookie: 1 as any });
  }).toThrow("Expected 'string' for 'DisTubeOptions.youtubeCookie', but got 1");
  expect(() => {
    new Options({ youtubeIdentityToken: {} as any });
  }).toThrow("Expected 'string' for 'DisTubeOptions.youtubeIdentityToken', but got {}");
  expect(() => {
    new Options({ invalidKey: "an invalid key" } as any);
  }).toThrow("'invalidKey' does not need to be provided in DisTubeOptions");
  expect(() => {
    new Options({ streamType: 2 });
  }).toThrow("Expected 'StreamType' for 'DisTubeOptions.streamType', but got 2");
});
