import { describe, expect, it } from "vitest";
import {
  describeFullTestSuiteCommand,
  shouldBlockFullTestSuiteCommand,
} from "../src/resource-policy.js";

describe("resource policy", () => {
  it("blocks full-suite make commands, including chained temp-dir execution", () => {
    expect(describeFullTestSuiteCommand("make test")).toBe("make test");
    expect(describeFullTestSuiteCommand("cd /tmp/refinery && make test")).toBe("make test");
    expect(describeFullTestSuiteCommand("make check 2>&1")).toBe("make check");
  });

  it("blocks unscoped full-suite test runners", () => {
    expect(describeFullTestSuiteCommand("go test ./...")).toBe("go test ./...");
    expect(describeFullTestSuiteCommand("bun test")).toBe("bun test");
    expect(describeFullTestSuiteCommand("bun run test")).toBe("bun test");
    expect(describeFullTestSuiteCommand("npm test")).toBe("npm test");
    expect(describeFullTestSuiteCommand("pytest")).toBe("pytest");
    expect(describeFullTestSuiteCommand("cargo test")).toBe("cargo test");
  });

  it("allows scoped tests", () => {
    expect(describeFullTestSuiteCommand("go test ./cmd/gc -run TestStart")).toBeNull();
    expect(describeFullTestSuiteCommand("bun test tests/resource-policy.test.ts")).toBeNull();
    expect(describeFullTestSuiteCommand("npm test -- tests/foo.test.ts")).toBeNull();
    expect(describeFullTestSuiteCommand("pytest tests/test_store.py")).toBeNull();
    expect(describeFullTestSuiteCommand("cargo test policy_guard")).toBeNull();
  });

  it("allows explicit override", () => {
    expect(
      shouldBlockFullTestSuiteCommand("make test", {
        CONTEXT_MODE_ALLOW_FULL_TESTS: "1",
      }),
    ).toBeNull();
  });
});
