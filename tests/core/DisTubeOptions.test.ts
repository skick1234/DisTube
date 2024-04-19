import { Options, defaultOptions } from "@";

test("Default DisTubeOptions", () => {
  expect(new Options({})).toEqual(defaultOptions);
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
  expect(() => {
    new Options(<any>NaN);
  }).toThrow("Expected 'object' for 'DisTubeOptions', but got NaN");
  for (const option of Object.keys(defaultOptions)) {
    const options = {};
    options[option] = NaN;
    expect(() => {
      new Options(options);
    }).toThrow(`Expected '${typeOfOption(option)}' for 'DisTubeOptions.${option}', but got NaN`);
  }
  expect(() => {
    new Options({ youtubeCookie: 1 as any });
  }).toThrow("Expected 'Array<Cookie>' or 'string' for 'DisTubeOptions.youtubeCookie', but got 1 (number)");
  expect(() => {
    new Options({ invalidKey: "an invalid key" } as any);
  }).toThrow("'invalidKey' does not need to be provided in DisTubeOptions");
  expect(() => {
    new Options({ streamType: 2 });
  }).toThrow("Expected 'StreamType' for 'DisTubeOptions.streamType', but got 2");
});
