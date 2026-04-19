import { describe, expect, it } from "vitest";

import {
  buildGcAgentActionPath,
  buildGcCityPath,
  buildGcRigActionPath,
  extractGcProblemMessage,
  resolveGcCityNameFromSupervisorCities,
  splitGcQualifiedName,
} from "./apiPaths.ts";

describe("gc api path helpers", () => {
  it("resolves the city name by matching the discovered city path", () => {
    expect(
      resolveGcCityNameFromSupervisorCities({
        raw: {
          items: [
            { name: "alpha", path: "/data/projects/alpha-city" },
            { name: "gastown", path: "/data/projects/gc" },
          ],
        },
        cityPath: "/data/projects/gc",
      }),
    ).toBe("gastown");
  });

  it("falls back to the only listed city when no path match is available", () => {
    expect(
      resolveGcCityNameFromSupervisorCities({
        raw: {
          items: [{ name: "gastown", path: "/tmp/other" }],
        },
        cityPath: null,
      }),
    ).toBe("gastown");
  });

  it("builds city-scoped resource and action paths", () => {
    expect(buildGcCityPath("gastown", "/config")).toBe("/v0/city/gastown/config");
    expect(buildGcAgentActionPath("gastown", "crew", "suspend")).toBe(
      "/v0/city/gastown/agent/crew/suspend",
    );
    expect(buildGcAgentActionPath("gastown", "t3code/gastown.crew", "resume")).toBe(
      "/v0/city/gastown/agent/t3code/gastown.crew/resume",
    );
    expect(buildGcRigActionPath("gastown", "t3code", "suspend")).toBe(
      "/v0/city/gastown/rig/t3code/suspend",
    );
  });

  it("splits only rig-qualified names", () => {
    expect(splitGcQualifiedName("crew")).toEqual({ dir: null, base: "crew" });
    expect(splitGcQualifiedName("t3code/crew")).toEqual({ dir: "t3code", base: "crew" });
  });

  it("prefers RFC 9457 detail strings when present", () => {
    expect(
      extractGcProblemMessage(
        503,
        JSON.stringify({
          detail: "no_providers: no running city has an event provider",
          title: "Service Unavailable",
        }),
      ),
    ).toBe("no_providers: no running city has an event provider");
    expect(extractGcProblemMessage(500, "plain text failure")).toBe("plain text failure");
  });
});
