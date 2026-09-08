import { describe, expect, test } from "bun:test";
import { inspectRuntimeVersion } from "./check-runtime";
import {
  inspectReleaseScripts,
  inspectVerifyScript,
  inspectWorkflow,
  requiredVerifyCommands,
  type WorkflowPolicy,
} from "./check-workflows";

const corePackages = [
  { name: "distube", version: "6.0.0" },
  { name: "@distube/discordjs", version: "6.0.0" },
  { name: "@distube/oceanic", version: "6.0.0" },
  { name: "@distube/eris", version: "6.0.0" },
] as const;

const publishPolicy: WorkflowPolicy = {
  file: "publish.yml",
  requiredCommands: ["bun run check:runtime", "bun run check:release-inputs", "bun run verify"],
  corePackages,
};

const archive = (name: string): string =>
  `../.candidate-bundle/.artifacts/release-candidate/core/archives/${name}-6.0.0.tgz`;
const candidateAsset = "candidate-$" + "{AUTHORIZED_RELEASE_CANDIDATE_ID}.tar.gz";

const validPublishWorkflow = `
jobs:
  publish:
    steps:
      - uses: actions/checkout@v4
        with: { path: DisTube }
      - run: |
          gh release download "\${{ github.event.release.tag_name }}" --repo "\${{ github.repository }}" --pattern "candidate-\${AUTHORIZED_RELEASE_CANDIDATE_ID}.tar.gz"
          python3 DisTube/scripts/extract-release-candidate.py "candidate-\${AUTHORIZED_RELEASE_CANDIDATE_ID}.tar.gz" .candidate-bundle
          test -f .candidate-bundle/.artifacts/release-candidate/manifest.json
      - uses: oven-sh/setup-bun@v2
        with: { bun-version: 1.4.2 }
      - uses: actions/setup-node@v4
        with: { node-version: 22.12.0, registry-url: "https://registry.npmjs.org" }
      - run: bun run check:runtime
      - run: bun run check:release-inputs
      - run: bun install --frozen-lockfile
      - run: bun run verify
      - env: { NODE_AUTH_TOKEN: token }
        run: bun ./scripts/check-publish-authorization.ts --candidate-dir=../.candidate-bundle/.artifacts/release-candidate --package=distube --archive=${archive("distube")} && npm publish ${archive("distube")} --provenance
      - env: { NODE_AUTH_TOKEN: token }
        run: bun ./scripts/check-publish-authorization.ts --candidate-dir=../.candidate-bundle/.artifacts/release-candidate --package=@distube/discordjs --archive=${archive("distube-discordjs")} && npm publish ${archive("distube-discordjs")} --provenance --access public
      - env: { NODE_AUTH_TOKEN: token }
        run: bun ./scripts/check-publish-authorization.ts --candidate-dir=../.candidate-bundle/.artifacts/release-candidate --package=@distube/oceanic --archive=${archive("distube-oceanic")} && npm publish ${archive("distube-oceanic")} --provenance --access public
      - env: { NODE_AUTH_TOKEN: token }
        run: bun ./scripts/check-publish-authorization.ts --candidate-dir=../.candidate-bundle/.artifacts/release-candidate --package=@distube/eris --archive=${archive("distube-eris")} && npm publish ${archive("distube-eris")} --provenance --access public
`;

describe("workflow parity", () => {
  test("rejects actual Bun runtime drift", () => {
    expect(inspectRuntimeVersion("1.4.2", "1.3.14")).toEqual(["expected Bun 1.4.2, observed 1.3.14"]);
  });

  test("rejects a canary revision that reports the pinned release version", () => {
    expect(inspectRuntimeVersion("1.4.2", "1.4.2", "1.4.2-canary.1+32e87032b")).toEqual([
      "expected stable Bun 1.4.2, observed canary revision 1.4.2-canary.1+32e87032b",
    ]);
  });

  test("accepts a stable Bun revision", () => {
    expect(inspectRuntimeVersion("1.4.2", "1.4.2", "1.4.2+32e87032b")).toEqual([]);
  });

  test("accepts candidate acquisition and direct archive publication", () => {
    expect(inspectWorkflow(validPublishWorkflow, "1.4.2", publishPolicy)).toEqual([]);
  });

  test("rejects a publish step with no registry credentials", () => {
    const workflow = validPublishWorkflow.replace(
      "      - env: { NODE_AUTH_TOKEN: token }\n        run: bun ./scripts/check-publish-authorization.ts --candidate-dir=../.candidate-bundle/.artifacts/release-candidate --package=distube",
      "      - run: bun ./scripts/check-publish-authorization.ts --candidate-dir=../.candidate-bundle/.artifacts/release-candidate --package=distube",
    );
    expect(inspectWorkflow(workflow, "1.4.2", publishPolicy)).toContain(
      "publish.yml: distube publish step must set NODE_AUTH_TOKEN",
    );
  });

  test("rejects publication that never pointed npm at the registry", () => {
    const workflow = validPublishWorkflow.replace(
      '      - uses: actions/setup-node@v4\n        with: { node-version: 22.12.0, registry-url: "https://registry.npmjs.org" }\n',
      "",
    );
    expect(inspectWorkflow(workflow, "1.4.2", publishPolicy)).toContain(
      "publish.yml: distube publish must follow a setup-node step with registry-url",
    );
  });

  test("rejects a scoped package published without public access", () => {
    const workflow = validPublishWorkflow.replace(
      `npm publish ${archive("distube-eris")} --provenance --access public`,
      `npm publish ${archive("distube-eris")} --provenance`,
    );
    expect(inspectWorkflow(workflow, "1.4.2", publishPolicy)).toContain(
      "publish.yml: scoped package @distube/eris must publish with --access public",
    );
  });

  test("rejects a missing exact candidate asset acquisition", () => {
    const workflow = validPublishWorkflow.replace(candidateAsset, "candidate.tgz");
    expect(inspectWorkflow(workflow, "1.4.2", publishPolicy)).toContain(
      "publish.yml: release download must select the exact authorized candidate asset",
    );
  });

  test("rejects direct or non-isolated candidate extraction", () => {
    const workflow = validPublishWorkflow.replace(
      `python3 DisTube/scripts/extract-release-candidate.py "${candidateAsset}" .candidate-bundle`,
      `tar -xzf "${candidateAsset}" -C .`,
    );
    const errors = inspectWorkflow(workflow, "1.4.2", publishPolicy);
    expect(errors).toContain("publish.yml: candidate asset must use validated extraction into .candidate-bundle");
    expect(errors).toContain("publish.yml: candidate asset must not use direct tar extraction");
  });

  test("rejects a wrong Bun pin", () => {
    expect(inspectWorkflow(validPublishWorkflow.replace("1.4.2", "1.3.14"), "1.4.2", publishPolicy)).toContain(
      "publish.yml: expected Bun 1.4.2",
    );
  });

  test("rejects an omitted dependency gate", () => {
    expect(
      inspectVerifyScript(
        requiredVerifyCommands.filter(command => command !== "bun run check:dependencies").join(" && "),
      ),
    ).toContain("verify script omits bun run check:dependencies");
  });

  test("rejects publication before verification", () => {
    const workflow = validPublishWorkflow.replace("      - run: bun run verify\n", "");
    expect(inspectWorkflow(workflow, "1.4.2", publishPolicy)).toContain(
      `publish.yml: bun run verify must finish before registry mutation npm publish ${archive("distube")} --provenance`,
    );
  });

  test("rejects verification that appears only after publication", () => {
    const firstPublish = `      - run: bun ./scripts/check-publish-authorization.ts --candidate-dir=../.candidate-bundle/.artifacts/release-candidate --package=distube --archive=${archive("distube")} && npm publish ${archive("distube")} --provenance\n`;
    const workflow = validPublishWorkflow
      .replace("      - run: bun run verify\n", "")
      .replace(firstPublish, `${firstPublish}      - run: bun run verify\n`);
    expect(inspectWorkflow(workflow, "1.4.2", publishPolicy)).toContain(
      `publish.yml: bun run verify must finish before registry mutation npm publish ${archive("distube")} --provenance`,
    );
  });

  test("requires authorization directly before each registry mutation", () => {
    const workflow = validPublishWorkflow.replace(
      `--package=distube --archive=${archive("distube")} && npm publish`,
      `--package=distube --archive=${archive("distube")} && bun run check && npm publish`,
    );
    expect(inspectWorkflow(workflow, "1.4.2", publishPolicy)).toContain(
      "publish.yml: distube authorization must run directly before npm publish",
    );
  });

  test("rejects a second mutation hidden after an authorized publish", () => {
    const workflow = validPublishWorkflow.replace(
      `npm publish ${archive("distube")} --provenance`,
      `npm publish ${archive("distube")} --provenance; npm deprecate distube@6.0.0 broken`,
    );
    expect(inspectWorkflow(workflow, "1.4.2", publishPolicy)).toContain(
      "publish.yml: forbidden registry mutation npm deprecate distube@6.0.0 broken",
    );
  });

  test("rejects a package-directory publication", () => {
    const workflow = validPublishWorkflow.replace(`npm publish ${archive("distube")}`, "npm publish packages/distube");
    expect(inspectWorkflow(workflow, "1.4.2", publishPolicy)).toContain(
      "publish.yml: npm publish must use an exact candidate core archive, found packages/distube",
    );
  });

  test("rejects every non-candidate registry mutation form", () => {
    for (const mutation of [
      "bun publish packages/distube",
      "changeset publish",
      "npm exec changeset publish",
      "npm exec -- changeset publish",
      "bunx changeset publish",
      "npx changeset publish",
      "npx --yes changeset publish",
      "npm deprecate distube@6.0.0 broken",
      "npm unpublish distube@6.0.0",
      "npm dist-tag add distube@6.0.0 latest",
      "npm dist-tag rm distube latest",
      "npm owner add user distube",
      "npm access set public distube",
    ]) {
      const workflow = validPublishWorkflow.replace(
        "      - run: bun run verify\n",
        `      - run: ${mutation}\n      - run: bun run verify\n`,
      );
      expect(inspectWorkflow(workflow, "1.4.2", publishPolicy)).toContain(
        `publish.yml: forbidden registry mutation ${mutation}`,
      );
    }
  });

  test("rejects package scripts that can mutate the registry", () => {
    expect(
      inspectReleaseScripts({ release: "changeset publish", deprecate: "npm deprecate distube@6.0.0 broken" }),
    ).toEqual([
      "package.json: publishing script release is forbidden",
      "package.json: publishing script deprecate is forbidden",
    ]);
  });

  test("accepts the complete non-publishing gate inventory", () => {
    expect(inspectVerifyScript(requiredVerifyCommands.join(" && "))).toEqual([]);
  });
});
