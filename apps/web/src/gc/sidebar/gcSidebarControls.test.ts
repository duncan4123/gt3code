import { describe, expect, it } from "vitest";

import { gcSessionNameForQualifiedAgent } from "./gcSidebarControls";

describe("gcSessionNameForQualifiedAgent", () => {
  it("uses rig session names for rig-scoped agents", () => {
    expect(gcSessionNameForQualifiedAgent("repo/refinery")).toBe("repo--refinery");
    expect(gcSessionNameForQualifiedAgent("city/repo/refinery")).toBe("city--repo--refinery");
  });

  it("uses city workspace session names when a workspace id is provided", () => {
    expect(
      gcSessionNameForQualifiedAgent("gastown/hq-polecat", { cityWorkspaceId: "gastown" }),
    ).toBe("gastown__hq-polecat");
    expect(gcSessionNameForQualifiedAgent("mayor", { cityWorkspaceId: "gastown" })).toBe(
      "gastown__mayor",
    );
  });
});
