import { describe, expect, it } from "vitest";

import type { GcConfigResult } from "@t3tools/contracts";

import { mergeCliExpandedConfigForTest } from "./GcApiClient.ts";

describe("mergeCliExpandedConfig", () => {
  it("keeps agents from the expanded CLI config when the remote config omits them", () => {
    const primary: GcConfigResult = {
      workspace: {
        name: "city",
        suspended: false,
      },
      agents: [
        {
          name: "crew",
          dir: "t3code",
          suspended: false,
        },
      ],
      rigs: [
        {
          name: "t3code",
          path: "/data/projects/t3code",
          suspended: false,
        },
      ],
    };
    const expanded: GcConfigResult = {
      workspace: {
        name: "city",
        suspended: false,
      },
      agents: [
        {
          name: "crew",
          dir: "t3code",
          suspended: false,
        },
        {
          name: "refinery",
          dir: "t3code",
          suspended: false,
        },
        {
          name: "polecat",
          dir: "t3code",
          suspended: false,
          is_pool: true,
          max_active_sessions: 5,
        },
      ],
      rigs: [
        {
          name: "t3code",
          path: "/data/projects/t3code",
          suspended: false,
        },
      ],
    };

    const merged = mergeCliExpandedConfigForTest(primary, expanded);

    expect(merged.agents.map((agent) => `${agent.dir ?? ""}/${agent.name}`)).toEqual([
      "t3code/crew",
      "t3code/refinery",
      "t3code/polecat",
    ]);
    expect(merged.agents.find((agent) => agent.name === "polecat")).toMatchObject({
      is_pool: true,
      max_active_sessions: 5,
    });
  });

  it("preserves primary agent values when both configs contain the same agent", () => {
    const primary: GcConfigResult = {
      workspace: {
        name: "city",
        suspended: false,
      },
      agents: [
        {
          name: "polecat",
          dir: "t3code",
          suspended: true,
          named_session_mode: "on_demand",
        },
      ],
      rigs: [],
    };
    const expanded: GcConfigResult = {
      workspace: {
        name: "city",
        suspended: false,
      },
      agents: [
        {
          name: "polecat",
          dir: "t3code",
          suspended: false,
          named_session_mode: "always",
          max_active_sessions: 5,
        },
      ],
      rigs: [],
    };

    const merged = mergeCliExpandedConfigForTest(primary, expanded);

    expect(merged.agents[0]).toMatchObject({
      suspended: true,
      named_session_mode: "on_demand",
      max_active_sessions: 5,
    });
  });
});
