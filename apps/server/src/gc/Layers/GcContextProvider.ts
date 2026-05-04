/**
 * GcContextProviderLive — Resolves full GC context for threads.
 *
 * Reads gc.bead, gc.convoy, gc.formula from thread customMetadata
 * and fetches live data from the GC API in parallel.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { Effect, Layer } from "effect";
import { GcApiClient } from "../Services/GcApiClient.ts";
import {
  GcContextProvider,
  type GcRuntimeDetails,
  type GcRuntimeMcpServer,
  type GcRuntimeSkill,
  type GcContextProviderShape,
  type GcThreadContext,
} from "../Services/GcContextProvider.ts";

function parseSessionEnv(value: string | undefined): Record<string, string> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed).flatMap(([key, entry]) =>
        typeof entry === "string" ? [[key, entry] as const] : [],
      ),
    );
  } catch {
    return {};
  }
}

function parseTomlString(value: string): string | undefined {
  const trimmed = value.trim();
  const match = trimmed.match(/^"((?:\\"|[^"])*)"$/);
  return match ? match[1]?.replaceAll('\\"', '"') : undefined;
}

function parseTomlStringArray(value: string): string[] | undefined {
  const trimmed = value.trim();
  if (!trimmed.startsWith("[") || !trimmed.endsWith("]")) return undefined;
  const matches = [...trimmed.matchAll(/"((?:\\"|[^"])*)"/g)];
  return matches.map((match) => match[1]?.replaceAll('\\"', '"') ?? "");
}

function readProjectedCodexMcp(workDir: string | undefined): {
  path?: string;
  servers: GcRuntimeMcpServer[];
} {
  if (!workDir) return { servers: [] };
  const configPath = path.join(workDir, ".codex", "config.toml");
  if (!existsSync(configPath)) return { path: configPath, servers: [] };
  const servers = new Map<string, GcRuntimeMcpServer>();
  let current: string | null = null;
  for (const rawLine of readFileSync(configPath, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    const section = line.match(/^\[mcp_servers\.([^\]]+)\]$/);
    if (section?.[1]) {
      current = section[1];
      servers.set(current, { name: current, source: "projected", path: configPath });
      continue;
    }
    if (!current || !line || line.startsWith("#")) continue;
    const splitAt = line.indexOf("=");
    if (splitAt < 0) continue;
    const key = line.slice(0, splitAt).trim();
    const value = line.slice(splitAt + 1).trim();
    const prior = servers.get(current);
    if (!prior) continue;
    if (key === "command") {
      const command = parseTomlString(value);
      servers.set(current, command ? { ...prior, command } : prior);
    } else if (key === "args") {
      const args = parseTomlStringArray(value);
      servers.set(current, args ? { ...prior, args } : prior);
    } else if (key === "url") {
      const url = parseTomlString(value);
      servers.set(current, url ? { ...prior, url } : prior);
    }
  }
  return { path: configPath, servers: [...servers.values()] };
}

function readSkillDescription(skillDir: string): string | undefined {
  const skillPath = path.join(skillDir, "SKILL.md");
  if (!existsSync(skillPath)) return undefined;
  const text = readFileSync(skillPath, "utf8").slice(0, 2_000);
  const match = text.match(/^description:\s*(.+)$/m);
  return match?.[1]?.trim().replace(/^["']|["']$/g, "");
}

function listSkillDirs(root: string, source: GcRuntimeSkill["source"]): GcRuntimeSkill[] {
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() || entry.isSymbolicLink())
    .flatMap((entry) => {
      const skillPath = path.join(root, entry.name);
      try {
        if (!statSync(skillPath).isDirectory()) return [];
      } catch {
        return [];
      }
      const description = readSkillDescription(skillPath);
      return [
        {
          name: entry.name,
          path: skillPath,
          source,
          ...(description ? { description } : {}),
        },
      ];
    })
    .sort((left, right) => left.name.localeCompare(right.name));
}

function uniqueSkills(skills: readonly GcRuntimeSkill[]): GcRuntimeSkill[] {
  const byKey = new Map<string, GcRuntimeSkill>();
  for (const skill of skills) {
    byKey.set(`${skill.source}:${skill.name}:${skill.path}`, skill);
  }
  return [...byKey.values()].sort((left, right) => {
    if (left.source !== right.source) return left.source.localeCompare(right.source);
    return left.name.localeCompare(right.name);
  });
}

function readRuntimeDetails(metadata: Record<string, string>): GcRuntimeDetails {
  const env = parseSessionEnv(metadata["gc.sessionEnv"]);
  const workDir = metadata["gc.startupWorkDir"] ?? env.GC_DIR;
  const cityPath = env.GC_CITY_PATH ?? env.GC_CITY_ROOT;
  const agentLabel = metadata["gc.agentLabel"] ?? metadata["gc.startupTemplate"];
  const projectedMcp = readProjectedCodexMcp(workDir);
  const materializedSkillRoots = workDir
    ? [path.join(workDir, ".codex", "skills"), path.join(workDir, ".claude", "skills")]
    : [];
  const sourceSkillRoots = [
    cityPath ? path.join(cityPath, ".gc", "system", "packs", "core", "skills") : undefined,
    cityPath ? path.join(cityPath, "packs", "gastown", "skills") : undefined,
    cityPath && agentLabel
      ? path.join(cityPath, "packs", "gastown", "agents", agentLabel, "skills")
      : undefined,
  ].filter((entry): entry is string => Boolean(entry));
  return {
    ...(workDir ? { workDir } : {}),
    ...(projectedMcp.path ? { mcpConfigPath: projectedMcp.path } : {}),
    mcpServers: projectedMcp.servers,
    skills: uniqueSkills([
      ...materializedSkillRoots.flatMap((root) => listSkillDirs(root, "materialized")),
      ...sourceSkillRoots.flatMap((root) => listSkillDirs(root, "source")),
    ]),
  };
}

const makeGcContextProvider = Effect.gen(function* () {
  const gcApi = yield* GcApiClient;

  const getThreadContext: GcContextProviderShape["getThreadContext"] = (metadata) =>
    Effect.gen(function* () {
      const beadId = metadata["gc.bead"];
      const convoyId = metadata["gc.convoy"];
      const formulaName = metadata["gc.formula"];

      const [bead, convoy, formula] = yield* Effect.all(
        [
          beadId ? gcApi.getBead(beadId) : Effect.succeed(null),
          convoyId ? gcApi.getConvoy(convoyId) : Effect.succeed(null),
          formulaName ? gcApi.getFormula(formulaName) : Effect.succeed(null),
        ],
        { concurrency: 3 },
      );

      const runtime = yield* Effect.sync(() => readRuntimeDetails(metadata));

      return { bead, convoy, formula, runtime } satisfies GcThreadContext;
    });

  const isAvailable = gcApi.isAvailable;

  return {
    getThreadContext,
    isAvailable,
  } satisfies GcContextProviderShape;
});

export const GcContextProviderLive = Layer.effect(GcContextProvider, makeGcContextProvider);
