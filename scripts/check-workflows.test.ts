import { describe, expect, test } from "bun:test";
import { inspectPublishAuthorization } from "./check-publish-authorization";
import { inspectStableReleaseInputs } from "./check-release-inputs";
import { inspectRuntimeVersion } from "./check-runtime";
import { inspectVerifyScript, inspectWorkflow, requiredVerifyCommands, type WorkflowPolicy } from "./check-workflows";

const publishPolicy: WorkflowPolicy = {
  file: "publish.yml",
  requiredCommands: ["bun run check:release-inputs", "bun run verify", "bun run check:publish-authorization"],
  publishCommand: "bun changeset publish",
};

const validPublishWorkflow = `
jobs:
  publish:
    steps:
      - uses: oven-sh/setup-bun@v2
        with: { bun-version: 1.3.14 }
      - run: bun run check:runtime
      - run: bun run check:release-inputs
      - run: bun install --frozen-lockfile
      - run: bun run verify
      - run: bun run check:publish-authorization
      - run: bun changeset publish
`;

describe("workflow parity", () => {
  test("rejects actual Bun runtime drift", () => {
    expect(inspectRuntimeVersion("1.3.14", "1.4.0")).toEqual(["expected Bun 1.3.14, observed 1.4.0"]);
  });

  test("rejects a wrong Bun pin", () => {
    expect(inspectWorkflow(validPublishWorkflow.replace("1.3.14", "1.4.0"), "1.3.14", publishPolicy)).toContain(
      "publish.yml: expected Bun 1.3.14",
    );
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
      inspectWorkflow(
        validPublishWorkflow.replace(
          "      - run: bun run verify",
          "      - run: bun changeset publish\n      - run: bun run verify",
        ),
        "1.3.14",
        publishPolicy,
      ),
    ).toContain("publish.yml: publish command precedes required verification");
  });

  test("accepts the complete non-publishing gate inventory", () => {
    expect(inspectVerifyScript(requiredVerifyCommands.join(" && "))).toEqual([]);
  });

  test("accepts formatting-equivalent YAML and verification in a needed job", () => {
    const workflow = `
jobs:
  verify:
    steps:
      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: "1.3.14"
      - run: |-
          bun run check:runtime
          bun run check:release-inputs
          bun install --frozen-lockfile
      - run: bun run verify
      - run: bun run check:publish-authorization
  publish:
    needs: verify
    steps:
      - run: bun changeset publish
`;
    expect(inspectWorkflow(workflow, "1.3.14", publishPolicy)).toEqual([]);
  });

  test("rejects publication without exact-candidate authorization", () => {
    expect(
      inspectWorkflow(
        validPublishWorkflow.replace("      - run: bun run check:publish-authorization\n", ""),
        "1.3.14",
        publishPolicy,
      ),
    ).toContain("publish.yml: exact-candidate authorization must precede publication");
    expect(inspectPublishAuthorization({})).toContain("publication is not explicitly authorized");
  });

  test("rejects stale candidate and source-revision authorization", () => {
    expect(
      inspectPublishAuthorization({
        publishAuthorized: "true",
        candidateId: "a".repeat(64),
        authorizedCandidateId: "b".repeat(64),
        sourceRevision: "c".repeat(40),
        candidateSourceRevision: "d".repeat(40),
      }),
    ).toEqual([
      "publication authorization does not name the current release candidate",
      "release source revision differs from the authorized candidate",
    ]);
  });

  test("rejects dirty, incomplete, or residue-bearing stable inputs", () => {
    expect(
      inspectStableReleaseInputs({
        manifests: {
          distube: { name: "distube", version: "6.0.0-dev.0" },
          discordjs: { name: "@distube/discordjs", version: "6.0.0", peerDependencies: { distube: "^6.0.0" } },
          oceanic: { name: "@distube/oceanic", version: "6.0.0", peerDependencies: { distube: "^6.0.0" } },
          eris: { name: "@distube/eris", version: "6.0.0", peerDependencies: { distube: "^6.0.0" } },
        },
        changesetFiles: ["config.json", "pending.md"],
        statusEntries: [" M packages/distube/package.json"],
        trackedPaths: ["distube-6.0.0.tgz"],
      }),
    ).toEqual([
      "distube: expected version 6.0.0, found 6.0.0-dev.0",
      "unconsumed changeset: .changeset/pending.md",
      "uncommitted release input:  M packages/distube/package.json",
      "committed release residue: distube-6.0.0.tgz",
    ]);
  });
});
