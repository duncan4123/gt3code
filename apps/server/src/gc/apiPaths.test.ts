import { describe, expect, it } from "vitest";

import { buildGcCityPath, resolveGcCityNameFromSupervisorCities } from "./apiPaths.ts";

describe("GC API paths", () => {
  it("uses the supervisor city name for a matching registered city path", () => {
    expect(
      resolveGcCityNameFromSupervisorCities({
        raw: {
          items: [
            {
              name: "gascity",
              path: "/data/projects/gc",
            },
          ],
        },
        cityPath: "/data/projects/gc",
      }),
    ).toBe("gascity");
  });

  it("prefers the only running city when the configured city is registered but stopped", () => {
    expect(
      resolveGcCityNameFromSupervisorCities({
        raw: {
          items: [
            {
              name: "gascity-br",
              path: "/repo/packages/gascity-config/config/cities/gascity-br",
              running: false,
              status: "suspended",
            },
            {
              name: "gastown",
              path: "/repo/packages/gascity-config/config/cities/gastown",
              running: true,
            },
          ],
        },
        cityPath: "/repo/packages/gascity-config/config/cities/gascity-br",
      }),
    ).toBe("gastown");
  });

  it("builds scoped city paths from the resolved city name", () => {
    expect(buildGcCityPath("gascity", "/config")).toBe("/v0/city/gascity/config");
  });
});
