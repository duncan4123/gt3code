import { Effect } from "effect";
import { GcApiClient } from "./src/gc/Services/GcApiClient.ts";
import { GcApiClientLive } from "./src/gc/Layers/GcApiClient.ts";

const target = "gascity/gastown.witness";
const mode = process.argv[2] === "always" ? "always" : "on_demand";
const program = Effect.gen(function* () {
  const client = yield* GcApiClient;
  const before = yield* client.getConfig();
  const beforeAgent =
    before?.agents.find((a) => (a.dir ? `${a.dir}/` : "") + a.name === target) ?? null;
  yield* client.setAgentSessionMode(target, mode);
  const after = yield* client.getConfig();
  const afterAgent =
    after?.agents.find((a) => (a.dir ? `${a.dir}/` : "") + a.name === target) ?? null;
  return { beforeAgent, afterAgent };
}).pipe(Effect.provide(GcApiClientLive));

const result = await Effect.runPromise(program);
console.log(JSON.stringify({ target, mode, result }, null, 2));
