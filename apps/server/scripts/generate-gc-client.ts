import { rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@hey-api/openapi-ts";

const DEFAULT_GC_API_URL = "http://127.0.0.1:9443";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const generatedOutput = path.resolve(scriptDir, "../src/gc/generated");

const rawInput = process.env.GC_OPENAPI_INPUT?.trim();
const rawApiUrl = process.env.GC_API_URL?.trim();
const apiBaseUrl = rawApiUrl && rawApiUrl.length > 0 ? rawApiUrl : DEFAULT_GC_API_URL;
const input =
  rawInput && rawInput.length > 0 ? rawInput : new URL("/openapi.json", apiBaseUrl).toString();

rmSync(generatedOutput, { force: true, recursive: true });

await createClient({
  input,
  logs: "silent",
  output: {
    importFileExtension: ".ts",
    path: generatedOutput,
  },
  plugins: ["@hey-api/client-fetch"],
});

console.log(`[gc-openapi] generated client from ${input} -> ${generatedOutput}`);
