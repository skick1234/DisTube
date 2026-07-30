import type { Client } from "oceanic.js";
import * as oceanicExports from "../src";

declare const client: Client;

new oceanicExports.OceanicAdapter(client, { connectionTimeoutMs: 10_000 });
// @ts-expect-error public Player factories are not configurable
new oceanicExports.OceanicAdapter(client, { playerFactory: async () => Promise.reject(new Error("unused")) });
// @ts-expect-error redundant create-adapter aliases are removed
oceanicExports.createOceanicAdapter;
