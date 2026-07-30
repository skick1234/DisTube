import { describe, expect, test } from "bun:test";
import { inspectRuntimeVersion } from "./check-runtime";
import { inspectVerifyScript, inspectWorkflow, requiredVerifyCommands, type WorkflowPolicy } from "./check-workflows";

const publishPolicy: WorkflowPolicy = {
  file: "publish.yml",
  requiredCommands: ["bun run verify"],
  publishCommand: "bun changeset publish",
};

describe("workflow parity", () => {
  test("rejects actual Bun runtime drift", () => {
    expect(inspectRuntimeVersion("1.3.14", "1.4.0")).toEqual(["expected Bun 1.3.14, observed 1.4.0"]);
  });

  test("rejects a wrong Bun pin", () => {
    expect(
      inspectWorkflow("bun-version: 1.4.0\nrun: bun run verify\nrun: bun changeset publish", "1.3.14", publishPolicy),
    ).toContain("publish.yml: expected Bun 1.3.14");
  });

  test("rejects an omitted dependency gate", () => {
    expect(
      inspectVerifyScript(
        requiredVerifyCommands.filter(command => command !== "bun run check:dependencies").join(" && "),
      ),
    ).toContain("verify script omits bun run check:dependencies");
  });

  test("rejects an omitted adapter compatibility gate", () => {
    expect(
      inspectVerifyScript(
        requiredVerifyCommands.filter(command => command !== "bun run check:adapter-compatibility").join(" && "),
      ),
    ).toContain("verify script omits bun run check:adapter-compatibility");
  });

  test("rejects publication before verification", () => {
    expect(
      inspectWorkflow("bun-version: 1.3.14\nrun: bun changeset publish\nrun: bun run verify", "1.3.14", publishPolicy),
    ).toContain("publish.yml: publish command precedes required verification");
  });

  test("accepts the complete non-publishing gate inventory", () => {
    expect(inspectVerifyScript(requiredVerifyCommands.join(" && "))).toEqual([]);
  });
});
