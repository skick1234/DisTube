import { DisTubeError, FilterManager, defaultFilters } from "@";
import type { FilterResolvable, Queue } from "@";

const playSong = jest.fn();
const queue = <Queue>(<unknown>{ distube: { queues: { playSong }, filters: defaultFilters } });

beforeEach(() => {
  jest.clearAllMocks();
});

const fNames = Object.keys(defaultFilters);
const fValues = Object.values(defaultFilters);

describe("FilterManager#add()", () => {
  const filters = new FilterManager(queue);
  test("Add a filter", () => {
    filters.add("3d");
    expect(filters.collection.size).toBe(1);
    expect(filters.has("3d")).toBe(true);
    expect(filters.collection.get("3d")).toEqual({ name: "3d", value: defaultFilters["3d"] });
    expect(filters.names).toEqual(["3d"]);
    expect(filters.values).toEqual([{ name: "3d", value: defaultFilters["3d"] }]);
    expect(filters.ffmpegArgs).toEqual(["-af", defaultFilters["3d"]]);
    expect(playSong).toBeCalledTimes(1);
  });
  test("Add a filter without override", () => {
    const oldFilter = filters.collection.get("3d");
    filters.add("3d", false);
    expect(filters.collection.size).toBe(1);
    expect(filters.has("3d")).toBe(true);
    expect(filters.collection.get("3d")).toBe(oldFilter);
    expect(filters.names).toEqual(["3d"]);
    expect(filters.values).toEqual([oldFilter]);
    expect(filters.ffmpegArgs).toEqual(["-af", oldFilter.value]);
    expect(playSong).toBeCalledTimes(1);
  });
  test("Add a filter with override", () => {
    const oldFilter = filters.collection.get("3d");
    filters.add("3d", true);
    expect(filters.collection.size).toBe(1);
    expect(filters.has("3d")).toBe(true);
    expect(filters.collection.get("3d")).not.toBe(oldFilter);
    expect(filters.collection.get("3d")).toEqual(oldFilter);
    expect(filters.names).toEqual(["3d"]);
    expect(filters.values).toEqual([oldFilter]);
    expect(filters.ffmpegArgs).toEqual(["-af", oldFilter.value]);
    expect(playSong).toBeCalledTimes(1);
  });
  test("Add multiple filters without override", () => {
    const oldFilter = filters.collection.get("3d");
    filters.add(fNames);
    expect(filters.collection.size).toBe(fNames.length);
    for (const filter of fNames) {
      expect(filters.has(filter)).toBe(true);
      expect(filters.collection.get(filter)).toEqual({ name: filter, value: defaultFilters[filter] });
    }
    expect(filters.collection.get("3d")).toBe(oldFilter);
    expect(filters.names).toEqual(fNames);
    expect(filters.values).toEqual(fNames.map(f => ({ name: f, value: defaultFilters[f] })));
    expect(filters.ffmpegArgs).toEqual(["-af", fValues.join(",")]);
    expect(playSong).toBeCalledTimes(1);
  });
  test("Add multiple filters with override", () => {
    const oldFilters = filters.collection.clone();
    filters.add(fNames, true);
    expect(filters.collection.size).toBe(fNames.length);
    for (const filter of fNames) {
      expect(filters.has(filter)).toBe(true);
      expect(filters.collection.get(filter)).not.toBe(oldFilters.get(filter));
      expect(filters.collection.get(filter)).toEqual({ name: filter, value: defaultFilters[filter] });
    }
    expect(filters.names).toEqual(fNames);
    expect(filters.values).toEqual(fNames.map(f => ({ name: f, value: defaultFilters[f] })));
    expect(filters.ffmpegArgs).toEqual(["-af", fValues.join(",")]);
    expect(playSong).toBeCalledTimes(1);
  });
  test("Add a custom filter", () => {
    const customFilter = { name: "custom", value: "customValue" };
    const oldFilters = filters.collection.clone();
    filters.add(customFilter);
    expect(filters.collection.size).toBe(fNames.length + 1);
    expect(filters.has(customFilter.name)).toBe(true);
    expect(filters.collection.get(customFilter.name)).toEqual(customFilter);
    for (const filter of fNames) {
      expect(filters.has(filter)).toBe(true);
      expect(filters.collection.get(filter)).toBe(oldFilters.get(filter));
    }
    expect(filters.names).toEqual([...fNames, customFilter.name]);
    expect(filters.values).toEqual([...fNames.map(f => ({ name: f, value: defaultFilters[f] })), customFilter]);
    expect(filters.ffmpegArgs).toEqual(["-af", [...fValues, customFilter.value].join(",")]);
    expect(playSong).toBeCalledTimes(1);
  });
  test("Add an invalid filter", () => {
    expect(() => filters.add(["invalid"])).toThrow(
      new DisTubeError("INVALID_TYPE", "FilterResolvable", "invalid", "filter"),
    );
    expect(() => filters.add({ name: "invalid", value: 1 } as any)).toThrow(
      new DisTubeError("INVALID_TYPE", "FilterResolvable", { name: "invalid", value: 1 }, "filter"),
    );
    expect(playSong).toBeCalledTimes(0);
  });
});

describe("FilterManager#remove()", () => {
  const filters = new FilterManager(queue);
  filters.add(fNames);
  test("Remove a filter", () => {
    filters.remove("3d");
    expect(filters.collection.size).toBe(fNames.length - 1);
    expect(filters.has("3d")).toBe(false);
    for (const filter of fNames) {
      if (filter === "3d") continue;
      expect(filters.has(filter)).toBe(true);
    }
    expect(filters.names).toEqual(fNames.filter(f => f !== "3d"));
    expect(filters.values).toEqual(fNames.filter(f => f !== "3d").map(f => ({ name: f, value: defaultFilters[f] })));
    expect(filters.ffmpegArgs).toEqual(["-af", fValues.filter(f => f !== defaultFilters["3d"]).join(",")]);
    expect(playSong).toBeCalledTimes(1);
  });
  test("Remove multiple filters", () => {
    // Remove some filters, "3d" filter is already removed
    const removedFilters = ["3d", "bassboost", "echo", "flanger"];
    const restFilters = fNames.filter(f => !removedFilters.includes(f));
    filters.remove(removedFilters);
    expect(filters.collection.size).toBe(restFilters.length);
    for (const filter of fNames) {
      expect(filters.has(filter)).toBe(!removedFilters.includes(filter));
    }
    expect(filters.names).toEqual(restFilters);
    expect(filters.values).toEqual(restFilters.map(f => ({ name: f, value: defaultFilters[f] })));
    expect(filters.ffmpegArgs).toEqual(["-af", restFilters.map(f => defaultFilters[f]).join(",")]);
    expect(playSong).toBeCalledTimes(1);
  });
});

describe("FilterManager#set()", () => {
  const filters = new FilterManager(queue);
  test("Set a filter", () => {
    filters.set(["3d"]);
    expect(filters.collection.size).toBe(1);
    expect(filters.has("3d")).toBe(true);
    expect(filters.collection.get("3d")).toEqual({ name: "3d", value: defaultFilters["3d"] });
    expect(filters.names).toEqual(["3d"]);
    expect(filters.values).toEqual([{ name: "3d", value: defaultFilters["3d"] }]);
    expect(filters.ffmpegArgs).toEqual(["-af", defaultFilters["3d"]]);
    expect(playSong).toBeCalledTimes(1);
  });
  test("Set multiple filters", () => {
    const oldFilter = filters.collection.get("3d");
    const newFilters: FilterResolvable[] = fNames;
    newFilters.push({ name: "custom", value: "customValue" });
    filters.set(newFilters);
    expect(filters.collection.size).toBe(newFilters.length);
    for (const filter of newFilters) {
      if (typeof filter === "string") {
        expect(filters.has(filter)).toBe(true);
        expect(filters.collection.get(filter)).toEqual({ name: filter, value: defaultFilters[filter] });
      } else {
        expect(filters.has(filter.name)).toBe(true);
        expect(filters.collection.get(filter.name)).toBe(filter);
      }
    }
    expect(filters.collection.get("3d")).not.toBe(oldFilter);
    expect(filters.names).toEqual(newFilters.map(f => (typeof f === "string" ? f : f.name)));
    expect(filters.toString()).toEqual(newFilters.map(f => (typeof f === "string" ? f : f.name)).toString());
    expect(filters.values).toEqual(
      newFilters.map(f => (typeof f === "string" ? { name: f, value: defaultFilters[f] } : f)),
    );
    expect(filters.ffmpegArgs).toEqual([
      "-af",
      newFilters.map(f => (typeof f === "string" ? defaultFilters[f] : f.value)).join(","),
    ]);
    expect(playSong).toBeCalledTimes(1);
  });
  test("Set with invalid arguments", () => {
    expect(() => filters.set(<any>{ name: "invalid", value: 1 })).toThrow(
      new DisTubeError("INVALID_TYPE", "Array<FilterResolvable>", { name: "invalid", value: 1 }, "filters"),
    );
    expect(() => filters.set(<any>0)).toThrow(
      new DisTubeError("INVALID_TYPE", "Array<FilterResolvable>", 0, "filters"),
    );
    expect(playSong).toBeCalledTimes(0);
  });
  test("FilterManager#clear()", () => {
    filters.clear();
    expect(filters.collection.size).toBe(0);
    expect(filters.names).toEqual([]);
    expect(filters.values).toEqual([]);
    expect(filters.ffmpegArgs).toEqual([]);
    expect(playSong).toBeCalledTimes(1);
  });
});
