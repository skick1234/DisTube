import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { assertPreparedBuild, ensurePreparedBuild } from "./prepared-build";

const root = resolve(import.meta.dir, "..");

async function run(command: string[]): Promise<void> {
  const child = Bun.spawn(command, { cwd: root, stdout: "inherit", stderr: "inherit" });
  const code = await child.exited;
  if (code !== 0) process.exit(code);
}

if (process.argv.includes("--prepared")) await assertPreparedBuild(root);
else await ensurePreparedBuild(root);
await run(["bun", "run", "api-extractor"]);
await run(["bun", "scripts/clean-source-declarations.ts"]);

interface ApiItem {
  readonly kind: string;
  readonly name?: string;
  readonly excerptTokens?: readonly { readonly text: string }[];
  readonly members?: readonly ApiItem[];
}

const modelPath = resolve(root, "reports/api-extractor/distube.api.json");
const apiDirectory = resolve(root, "website/api");
await mkdir(apiDirectory, { recursive: true });
const model = JSON.parse(await readFile(modelPath, "utf8")) as ApiItem;
const entryPoint = model.members?.find(item => item.kind === "EntryPoint");
if (!entryPoint?.members?.length) throw new Error("API Extractor produced no public entry-point members");

function excerpt(item: ApiItem): string {
  return (
    item.excerptTokens
      ?.map(token => token.text)
      .join("")
      .trim() ?? ""
  );
}

const apiSections = entryPoint.members.flatMap(item => {
  const sections = [`## ${item.name ?? item.kind}`, "", `_${item.kind}_`, ""];
  const signature = excerpt(item);
  if (signature) sections.push("```ts", signature, "```", "");
  for (const member of item.members ?? []) {
    sections.push(`### ${member.name ?? member.kind}`, "");
    const memberSignature = excerpt(member);
    if (memberSignature) sections.push("```ts", memberSignature, "```", "");
  }
  return sections;
});

await writeFile(
  resolve(apiDirectory, "index.md"),
  [
    "# API reference",
    "",
    "This reference is generated from the built `distube` declaration surface by API Extractor.",
    "",
    ...apiSections,
  ].join("\n"),
);

await run(["bunx", "vitepress", "build", "website", "--outDir", "../docs"]);
