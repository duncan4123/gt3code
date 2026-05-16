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

  it("builds scoped city paths from the resolved city name", () => {
    expect(buildGcCityPath("gascity", "/config")).toBe("/v0/city/gascity/config");
  });
});
