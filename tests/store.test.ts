/**
 * ContentStore — FTS5 BM25 Knowledge Base Tests
 *
 * Tests chunking, indexing, search, multi-source, and edge cases
 * using real fixtures from Context7 and MCP tools.
 */

import { describe, test, expect } from "vitest";
import { strict as assert } from "node:assert";
import { readFileSync, writeFileSync, existsSync, unlinkSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { ContentStore, cleanupStaleDBs } from "../src/store.js";
import { withRetry } from "../src/db-base.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixtureDir = join(__dirname, "fixtures");

function createStore(): ContentStore {
  const path = join(
    tmpdir(),
    `context-mode-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`,
  );
  return new ContentStore(path);
}

function hasDoltliteVersioning(): boolean {
  const store = createStore();
  try {
    const engine = store.queryOne("SELECT doltlite_engine() as e") as { e: string } | undefined;
    return engine?.e === "prolly";
  } catch {
    return false;
  } finally {
    store.close();
  }
}

const DOLTLITE_ENABLED = hasDoltliteVersioning();

describe("Schema & Lifecycle", () => {
  test("creates store with empty stats", () => {
    const store = createStore();
    const stats = store.getStats();
    assert.equal(stats.sources, 0);
    assert.equal(stats.chunks, 0);
    assert.equal(stats.codeChunks, 0);
    store.close();
  });

  test("close is idempotent", () => {
    const store = createStore();
    store.close();
    // second close should not throw
    assert.doesNotThrow(() => store.close());
  });

  test("creates draft convoy/bead tables", () => {
    const store = createStore();
    const tables = store.queryAll(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('issues', 'dependencies', 'labels', 'comments', 'events') ORDER BY name",
    ) as Array<{ name: string }>;
    assert.deepEqual(
      tables.map((t) => t.name),
      ["comments", "dependencies", "events", "issues", "labels"],
    );
    store.close();
  });
});

describe("Draft convoy/bead schema", () => {
  test("stores convoy, bead, labels, and dependency hierarchy", () => {
    const store = createStore();
    const convoyId = "convoy-1";
    const beadId = "bead-1";
    const now = "2026-04-03T00:00:00.000Z";

    store.exec(
      `INSERT INTO issues (id, title, description, issue_type, status, rig, created_at, updated_at, metadata)
       VALUES ('${convoyId}', 'Integrate context mode', 'Top-level rollout', 'convoy', 'open', 't3code', '${now}', '${now}', '{"phase":"draft"}')`,
    );
    store.exec(`INSERT INTO labels (issue_id, label) VALUES ('${convoyId}', 'draft')`);

    store.exec(
      `INSERT INTO issues (id, title, description, issue_type, status, rig, priority, assignee, created_at, updated_at, metadata)
       VALUES ('${beadId}', 'Wire doltlite schema', 'Add issue tables', 'task', 'open', 't3code', 1, 'codex', '${now}', '${now}', '{}')`,
    );
    store.exec(`INSERT INTO labels (issue_id, label) VALUES ('${beadId}', 'draft')`);
    store.exec(
      `INSERT INTO dependencies (issue_id, depends_on_id, type, created_at, created_by)
       VALUES ('${beadId}', '${convoyId}', 'child-of', '${now}', 'test')`,
    );

    const convoy = store.queryOne(
      "SELECT title, issue_type, rig FROM issues WHERE id = ?",
      convoyId,
    ) as { title: string; issue_type: string; rig: string } | undefined;
    assert.equal(convoy?.title, "Integrate context mode");
    assert.equal(convoy?.issue_type, "convoy");
    assert.equal(convoy?.rig, "t3code");

    const bead = store.queryOne(
      "SELECT title, issue_type, priority, assignee FROM issues WHERE id = ?",
      beadId,
    ) as { title: string; issue_type: string; priority: number; assignee: string } | undefined;
    assert.equal(bead?.title, "Wire doltlite schema");
    assert.equal(bead?.issue_type, "task");
    assert.equal(bead?.priority, 1);
    assert.equal(bead?.assignee, "codex");

    const childLink = store.queryOne(
      "SELECT type, created_by FROM dependencies WHERE issue_id = ? AND depends_on_id = ?",
      beadId,
      convoyId,
    ) as { type: string; created_by: string } | undefined;
    assert.equal(childLink?.type, "child-of");
    assert.equal(childLink?.created_by, "test");

    const draftLabels = store.queryAll(
      "SELECT issue_id FROM labels WHERE label = 'draft' ORDER BY issue_id",
    ) as Array<{ issue_id: string }>;
    assert.deepEqual(draftLabels.map((r) => r.issue_id), [beadId, convoyId]);
    store.close();
  });

  test("convoy list query returns only draft convoys with ordered beads and blocker counts", () => {
    const store = createStore();
    const now = "2026-04-03T00:00:00.000Z";
    const convoyId = "convoy-list-1";
    const firstBead = "bead-list-1";
    const secondBead = "bead-list-2";

    store.exec(
      `INSERT INTO issues (id, title, description, issue_type, status, rig, created_at, updated_at, metadata)
       VALUES ('${convoyId}', 'GC integration', 'Draft convoy', 'convoy', 'open', 'gascity', '${now}', '${now}', '{}')`,
    );
    store.exec(`INSERT INTO labels (issue_id, label) VALUES ('${convoyId}', 'draft')`);

    store.exec(
      `INSERT INTO issues (id, title, description, issue_type, status, rig, priority, assignee, created_at, updated_at, metadata)
       VALUES ('${firstBead}', 'Build bridge UI', 'UI work', 'task', 'open', 't3code', 2, 'alice', '${now}', '${now}', '{}')`,
    );
    store.exec(
      `INSERT INTO issues (id, title, description, issue_type, status, rig, priority, assignee, created_at, updated_at, metadata)
       VALUES ('${secondBead}', 'Add sync endpoint', 'API work', 'gate', 'open', 'gascity', 1, '', '${now}', '${now}', '{}')`,
    );
    store.exec(
      `INSERT INTO dependencies (issue_id, depends_on_id, type, created_at, created_by)
       VALUES ('${firstBead}', '${convoyId}', 'child-of', '${now}', 'test')`,
    );
    store.exec(
      `INSERT INTO dependencies (issue_id, depends_on_id, type, created_at, created_by)
       VALUES ('${secondBead}', '${convoyId}', 'child-of', '${now}', 'test')`,
    );
    store.exec(
      `INSERT INTO dependencies (issue_id, depends_on_id, type, created_at, created_by)
       VALUES ('${firstBead}', '${secondBead}', 'blocks', '${now}', 'test')`,
    );

    const convoys = store.queryAll(
      `SELECT id, title, description, rig, status, created_at FROM issues
       WHERE issue_type = 'convoy' AND id IN (SELECT issue_id FROM labels WHERE label = 'draft')
       ORDER BY created_at DESC`,
    ) as Array<{ id: string; title: string }>;
    assert.equal(convoys.length, 1);
    assert.equal(convoys[0].id, convoyId);

    const beads = store.queryAll(
      `SELECT i.id, i.title, i.issue_type, i.rig, i.priority, i.assignee
       FROM issues i
       JOIN dependencies d ON d.issue_id = i.id AND d.depends_on_id = ? AND d.type = 'child-of'
       WHERE i.issue_type != 'convoy'
       ORDER BY i.priority, i.created_at`,
      convoyId,
    ) as Array<{ id: string; title: string; priority: number; issue_type: string; rig: string; assignee: string }>;

    assert.deepEqual(
      beads.map((b) => ({ id: b.id, title: b.title, priority: b.priority })),
      [
        { id: secondBead, title: "Add sync endpoint", priority: 1 },
        { id: firstBead, title: "Build bridge UI", priority: 2 },
      ],
    );

    const blockerCounts = beads.map((b) => store.queryOne(
      "SELECT COUNT(*) as n FROM dependencies WHERE issue_id = ? AND type = 'blocks'",
      b.id,
    ) as { n: number });
    assert.deepEqual(blockerCounts.map((r) => r.n), [0, 1]);
    assert.equal(beads[0].issue_type, "gate");
    assert.equal(beads[0].rig, "gascity");
    assert.equal(beads[1].assignee, "alice");
    store.close();
  });
});

describe.runIf(DOLTLITE_ENABLED)("Doltlite version control", () => {
  test("commits indexed content and records clean history", () => {
    const store = createStore();
    try {
      const engine = store.queryOne("SELECT doltlite_engine() as e") as { e: string } | undefined;
      assert.equal(engine?.e, "prolly");

      store.index({
        content: "# Alpha\n\nInitial snapshot content.",
        source: "alpha-doc",
      });

      const dirtyBeforeCommit = store.queryAll(
        "SELECT table_name, staged, status FROM dolt_status",
      ) as Array<{ table_name: string; staged: number | boolean; status: string }>;
      assert.ok(dirtyBeforeCommit.length > 0, "Expected uncommitted changes before first commit");

      store.exec(`SELECT dolt_add('-A')`);
      const firstCommit = store.queryOne(
        "SELECT dolt_commit('-m', ?) as hash",
        "initial snapshot",
      ) as { hash: string } | undefined;
      assert.match(firstCommit?.hash ?? "", /^[0-9a-f]{40}$/);

      const cleanStatus = store.queryAll(
        "SELECT table_name, staged, status FROM dolt_status",
      ) as Array<{ table_name: string; staged: number | boolean; status: string }>;
      assert.equal(cleanStatus.length, 0, "Working set should be clean after commit");

      const firstLog = store.queryAll(
        "SELECT commit_hash, message FROM dolt_log LIMIT 1",
      ) as Array<{ commit_hash: string; message: string }>;
      assert.equal(firstLog[0]?.message, "initial snapshot");
      assert.equal(firstLog[0]?.commit_hash, firstCommit?.hash);

      store.index({
        content: "# Beta\n\nFollow-up snapshot content.",
        source: "beta-doc",
      });

      const dirtyAfterSecondIndex = store.queryAll(
        "SELECT table_name, staged, status FROM dolt_status",
      ) as Array<{ table_name: string; staged: number | boolean; status: string }>;
      assert.ok(dirtyAfterSecondIndex.length > 0, "Expected changes after second index");

      store.exec(`SELECT dolt_add('-A')`);
      const secondCommit = store.queryOne(
        "SELECT dolt_commit('-m', ?) as hash",
        "second snapshot",
      ) as { hash: string } | undefined;
      assert.match(secondCommit?.hash ?? "", /^[0-9a-f]{40}$/);
      assert.notEqual(secondCommit?.hash, firstCommit?.hash);

      const log = store.queryAll(
        "SELECT commit_hash, message FROM dolt_log LIMIT 2",
      ) as Array<{ commit_hash: string; message: string }>;
      assert.equal(log.length, 2);
      assert.equal(log[0]?.message, "second snapshot");
      assert.equal(log[1]?.message, "initial snapshot");
    } finally {
      store.close();
    }
  });

  test("supports branch checkout isolation and tags for knowledge base state", () => {
    const store = createStore();
    try {
      store.index({
        content: "# Main\n\nBase branch content.",
        source: "main-doc",
      });
      store.exec(`SELECT dolt_add('-A')`);
      const baseCommit = store.queryOne(
        "SELECT dolt_commit('-m', ?) as hash",
        "base snapshot",
      ) as { hash: string } | undefined;
      assert.match(baseCommit?.hash ?? "", /^[0-9a-f]{40}$/);

      const branchResult = store.queryOne(
        "SELECT dolt_branch('experiment') as r",
      ) as { r: number } | undefined;
      assert.equal(branchResult?.r, 0);

      const checkoutExperiment = store.queryOne(
        "SELECT dolt_checkout('experiment') as r",
      ) as { r: number } | undefined;
      assert.equal(checkoutExperiment?.r, 0);

      const currentExperiment = store.queryOne(
        "SELECT active_branch() as name",
      ) as { name: string } | undefined;
      assert.equal(currentExperiment?.name, "experiment");

      store.index({
        content: "# Experiment\n\nBranch-only content.",
        source: "experiment-doc",
      });
      store.exec(`SELECT dolt_add('-A')`);
      const experimentCommit = store.queryOne(
        "SELECT dolt_commit('-m', ?) as hash",
        "experiment snapshot",
      ) as { hash: string } | undefined;
      assert.match(experimentCommit?.hash ?? "", /^[0-9a-f]{40}$/);

      const experimentCount = store.queryOne(
        "SELECT COUNT(*) as n FROM sources WHERE label = ?",
        "experiment-doc",
      ) as { n: number } | undefined;
      assert.equal(experimentCount?.n, 1);

      const tagResult = store.queryOne(
        "SELECT dolt_tag('experiment-v1') as r",
      ) as { r: number } | undefined;
      assert.equal(tagResult?.r, 0);

      const tags = store.queryAll(
        "SELECT tag_name, tag_hash, message FROM dolt_tags ORDER BY tag_name",
      ) as Array<{ tag_name: string; tag_hash: string; message: string }>;
      const experimentTag = tags.find((tag) => tag.tag_name === "experiment-v1");
      assert.ok(experimentTag);
      assert.equal(experimentTag?.tag_hash, experimentCommit?.hash);

      const checkoutMain = store.queryOne(
        "SELECT dolt_checkout('main') as r",
      ) as { r: number } | undefined;
      assert.equal(checkoutMain?.r, 0);

      const currentMain = store.queryOne(
        "SELECT active_branch() as name",
      ) as { name: string } | undefined;
      assert.equal(currentMain?.name, "main");

      const mainCount = store.queryOne(
        "SELECT COUNT(*) as n FROM sources WHERE label = ?",
        "experiment-doc",
      ) as { n: number } | undefined;
      assert.equal(mainCount?.n, 0, "Branch-only source should not leak back to main");

      const branches = store.queryAll(
        "SELECT name FROM dolt_branches ORDER BY name",
      ) as Array<{ name: string }>;
      assert.deepEqual(
        branches.map((branch) => branch.name),
        ["experiment", "main"],
      );
    } finally {
      store.close();
    }
  });
});

describe("Basic Indexing", () => {
  test("index simple markdown content", () => {
    const store = createStore();
    const result = store.index({
      content: "# Hello\n\nThis is a test document.",
      source: "test-doc",
    });
    assert.equal(result.label, "test-doc");
    assert.equal(result.totalChunks, 1);
    assert.equal(result.codeChunks, 0);
    assert.ok(result.sourceId > 0);
    store.close();
  });

  test("index content with code blocks", () => {
    const store = createStore();
    const result = store.index({
      content:
        "# API Guide\n\n```javascript\nconsole.log('hello');\n```\n\n## Usage\n\nSome text.",
      source: "api-guide",
    });
    assert.ok(result.totalChunks >= 1);
    assert.ok(result.codeChunks >= 1, "Should detect code chunks");
    store.close();
  });

  test("index empty content throws (falsy content requires path)", () => {
    const store = createStore();
    // Empty string is falsy — same as not providing content
    assert.throws(() => store.index({ content: "", source: "empty" }), /Either content or path/);
    store.close();
  });

  test("index whitespace-only content returns 0 chunks", () => {
    const store = createStore();
    const result = store.index({
      content: "   \n\n   \n",
      source: "whitespace",
    });
    assert.equal(result.totalChunks, 0);
    store.close();
  });

  test("index from file path", () => {
    const store = createStore();
    const result = store.index({
      path: join(fixtureDir, "context7-react-docs.md"),
      source: "Context7: React useEffect",
    });
    assert.ok(result.totalChunks > 0, "Should chunk the fixture");
    assert.ok(result.codeChunks > 0, "React docs have code blocks");
    assert.equal(result.label, "Context7: React useEffect");
    store.close();
  });

  test("index throws when neither content nor path provided", () => {
    const store = createStore();
    assert.throws(() => store.index({}), /Either content or path/);
    store.close();
  });

  test("stats update after indexing", () => {
    const store = createStore();
    store.index({
      content: "# Title\n\nSome content.\n\n## Section\n\nMore content.",
      source: "doc-1",
    });
    const stats = store.getStats();
    assert.ok(stats.sources >= 1);
    assert.ok(stats.chunks >= 1);
    store.close();
  });
});

describe("Heading-Aware Chunking", () => {
  test("splits on H1-H4 headings", () => {
    const store = createStore();
    const result = store.index({
      content:
        "# H1\n\nContent 1\n\n## H2\n\nContent 2\n\n### H3\n\nContent 3\n\n#### H4\n\nContent 4",
      source: "headings",
    });
    assert.equal(result.totalChunks, 4, "Should split into 4 chunks");
    store.close();
  });

  test("splits on --- separators (Context7 format)", () => {
    const store = createStore();
    const result = store.index({
      content:
        "### Section A\n\nContent A\n\n---\n\n### Section B\n\nContent B\n\n---\n\n### Section C\n\nContent C",
      source: "context7-style",
    });
    assert.equal(result.totalChunks, 3, "Should split on --- separators");
    store.close();
  });

  test("keeps code blocks intact (never split mid-block)", () => {
    const store = createStore();
    const result = store.index({
      content:
        '# Example\n\n```javascript\nfunction hello() {\n  console.log("world");\n}\nhello();\n```\n\nMore text after code.',
      source: "code-intact",
    });
    assert.equal(result.totalChunks, 1, "Code block stays with heading");

    // Search should return the complete code block
    const results = store.search("hello function", 1);
    assert.ok(results.length > 0);
    assert.ok(
      results[0].content.includes("console.log"),
      "Code block should be intact",
    );
    assert.ok(
      results[0].content.includes("hello()"),
      "Full code block preserved",
    );
    store.close();
  });

  test("tracks heading hierarchy in titles", () => {
    const store = createStore();
    store.index({
      content:
        "# React\n\n## Hooks\n\n### useEffect\n\nEffect documentation here.",
      source: "hierarchy",
    });
    const results = store.search("Effect documentation", 1);
    assert.ok(results.length > 0);
    assert.ok(
      results[0].title.includes("React"),
      `Title should include H1, got: ${results[0].title}`,
    );
    assert.ok(
      results[0].title.includes("Hooks"),
      `Title should include H2, got: ${results[0].title}`,
    );
    assert.ok(
      results[0].title.includes("useEffect"),
      `Title should include H3, got: ${results[0].title}`,
    );
    store.close();
  });

  test("marks chunks with code as 'code' contentType", () => {
    const store = createStore();
    store.index({
      content:
        "# Prose\n\nJust text.\n\n# Code\n\n```python\nprint('hello')\n```",
      source: "mixed",
    });

    const proseResults = store.search("Just text", 1);
    assert.ok(proseResults.length > 0);
    assert.equal(proseResults[0].contentType, "prose");

    const codeResults = store.search("python print hello", 1);
    assert.ok(codeResults.length > 0);
    assert.equal(codeResults[0].contentType, "code");

    store.close();
  });
});

describe("BM25 Search", () => {
  test("basic keyword search returns results", () => {
    const store = createStore();
    store.index({
      content:
        "# Authentication\n\nUse JWT tokens for API auth.\n\n# Caching\n\nRedis for session caching.",
      source: "docs",
    });
    const results = store.search("JWT authentication", 2);
    assert.ok(results.length > 0, "Should find results");
    assert.ok(
      results[0].content.includes("JWT"),
      "First result should be about JWT",
    );
    store.close();
  });

  test("title match weighted higher than content match", () => {
    const store = createStore();
    store.index({
      content:
        "# useEffect\n\nThe effect hook.\n\n# useState\n\nuseEffect is mentioned here in passing.",
      source: "hooks",
    });
    const results = store.search("useEffect", 2);
    assert.ok(results.length >= 1);
    // The chunk with useEffect in the TITLE should rank first
    assert.ok(
      results[0].title.includes("useEffect"),
      `Title match should rank first, got title: ${results[0].title}`,
    );
    store.close();
  });

  test("porter stemming matches word variants", () => {
    const store = createStore();
    store.index({
      content:
        "# Connecting\n\nEstablish connections to the database.\n\n# Caching\n\nCache your responses.",
      source: "stemming",
    });
    // "connect" should match "connecting" and "connections"
    const results = store.search("connect", 1);
    assert.ok(results.length > 0);
    assert.ok(
      results[0].content.includes("connections") ||
        results[0].title.includes("Connecting"),
      "Stemming should match variants",
    );
    store.close();
  });

  test("search with no results returns empty array", () => {
    const store = createStore();
    store.index({
      content: "# React\n\nComponent lifecycle.",
      source: "react",
    });
    const results = store.search("kubernetes deployment yaml", 3);
    assert.equal(results.length, 0, "Should return empty for irrelevant query");
    store.close();
  });

  test("limit parameter controls result count", () => {
    const store = createStore();
    store.index({
      content:
        "# A\n\nApple.\n\n# B\n\nBanana.\n\n# C\n\nCherry.\n\n# D\n\nDate.",
      source: "fruits",
    });
    const results1 = store.search("fruit", 1);
    assert.ok(results1.length <= 1);

    const results3 = store.search("fruit", 10);
    // May return less if not all match
    assert.ok(results3.length >= 0);
    store.close();
  });

  test("results include source label", () => {
    const store = createStore();
    store.index({
      content: "# Setup\n\nInstall the package.",
      source: "Context7: React docs",
    });
    const results = store.search("Install package", 1);
    assert.ok(results.length > 0);
    assert.equal(results[0].source, "Context7: React docs");
    store.close();
  });

  test("results include rank score", () => {
    const store = createStore();
    store.index({
      content: "# Test\n\nSome test content here.",
      source: "ranked",
    });
    const results = store.search("test content", 1);
    assert.ok(results.length > 0);
    assert.equal(typeof results[0].rank, "number");
    store.close();
  });
});

describe("Multi-Source Indexing", () => {
  test("search across multiple indexed sources", () => {
    const store = createStore();
    store.index({
      content: "# React Hooks\n\nuseEffect for side effects.",
      source: "Context7: React",
    });
    store.index({
      content: "# Supabase Auth\n\nRow Level Security policies.",
      source: "Context7: Supabase",
    });
    store.index({
      content: "# Tailwind\n\nResponsive breakpoints with sm, md, lg.",
      source: "Context7: Tailwind",
    });

    const reactResults = store.search("useEffect", 1);
    assert.ok(reactResults.length > 0);
    assert.equal(reactResults[0].source, "Context7: React");

    const supaResults = store.search("Row Level Security", 1);
    assert.ok(supaResults.length > 0);
    assert.equal(supaResults[0].source, "Context7: Supabase");

    const twResults = store.search("responsive breakpoints", 1);
    assert.ok(twResults.length > 0);
    assert.equal(twResults[0].source, "Context7: Tailwind");

    const stats = store.getStats();
    assert.equal(stats.sources, 3);
    store.close();
  });

  test("re-indexing same source replaces previous entry (dedup)", () => {
    const store = createStore();
    store.index({
      content: "# Part 1\n\nFirst batch.",
      source: "incremental",
    });
    store.index({
      content: "# Part 2\n\nSecond batch.",
      source: "incremental",
    });
    const stats = store.getStats();
    assert.equal(stats.sources, 1, "Dedup replaces previous source with same label");
    assert.ok(stats.chunks >= 1);
    store.close();
  });
});

describe("Fixture-Based Tests (Real MCP Output)", () => {
  test("Context7 React docs: index and search code examples", () => {
    const store = createStore();
    const content = readFileSync(
      join(fixtureDir, "context7-react-docs.md"),
      "utf-8",
    );
    const result = store.index({
      content,
      source: "Context7: React useEffect",
    });
    assert.ok(result.totalChunks >= 3, `Expected >=3 chunks, got ${result.totalChunks}`);
    assert.ok(result.codeChunks >= 1, "Should detect code chunks");

    // Search for specific code patterns
    const cleanup = store.search("cleanup function disconnect", 2);
    assert.ok(cleanup.length > 0, "Should find cleanup pattern");
    assert.ok(
      cleanup[0].content.includes("disconnect"),
      "Should contain exact disconnect code",
    );

    // Search for fetch pattern
    const fetch = store.search("fetch data ignore stale", 2);
    assert.ok(fetch.length > 0, "Should find fetch pattern");
    assert.ok(
      fetch[0].content.includes("ignore"),
      "Should contain ignore flag pattern",
    );

    store.close();
  });

  test("Context7 Next.js docs: index and search", () => {
    const store = createStore();
    const content = readFileSync(
      join(fixtureDir, "context7-nextjs-docs.md"),
      "utf-8",
    );
    const result = store.index({
      content,
      source: "Context7: Next.js App Router",
    });
    assert.ok(result.totalChunks >= 2, `Expected >=2 chunks, got ${result.totalChunks}`);

    // Search should return relevant content
    const results = store.search("App Router", 1);
    assert.ok(results.length > 0);
    assert.equal(results[0].source, "Context7: Next.js App Router");
    store.close();
  });

  test("Context7 Tailwind docs: index and search", () => {
    const store = createStore();
    const content = readFileSync(
      join(fixtureDir, "context7-tailwind-docs.md"),
      "utf-8",
    );
    const result = store.index({
      content,
      source: "Context7: Tailwind CSS",
    });
    assert.ok(result.totalChunks >= 1);

    const results = store.search("Tailwind", 1);
    assert.ok(results.length > 0);
    assert.equal(results[0].source, "Context7: Tailwind CSS");
    store.close();
  });

  test("MCP tools JSON: index and search tool signatures", () => {
    const store = createStore();
    // Convert JSON to searchable markdown format
    const raw = readFileSync(join(fixtureDir, "mcp-tools.json"), "utf-8");
    const tools = JSON.parse(raw);

    const markdown = tools
      .map(
        (t: { name: string; description: string }) =>
          `### ${t.name}\n\n${t.description}`,
      )
      .join("\n\n---\n\n");

    const result = store.index({
      content: markdown,
      source: "MCP: tools/list",
    });
    assert.ok(
      result.totalChunks >= 5,
      `Expected >=5 chunks for 40 tools, got ${result.totalChunks}`,
    );
    store.close();
  });
});

describe("Query Sanitization", () => {
  test("handles special FTS5 characters in query", () => {
    const store = createStore();
    store.index({
      content: "# Test\n\nSome content here.",
      source: "sanitize",
    });
    // These should not throw FTS5 parse errors
    assert.doesNotThrow(() => store.search('test "quoted"', 1));
    assert.doesNotThrow(() => store.search("test AND OR NOT", 1));
    assert.doesNotThrow(() => store.search("test()", 1));
    assert.doesNotThrow(() => store.search("test*", 1));
    assert.doesNotThrow(() => store.search("test:value", 1));
    assert.doesNotThrow(() => store.search("test^2", 1));
    assert.doesNotThrow(() => store.search("{test}", 1));
    assert.doesNotThrow(() => store.search("NEAR/3", 1));
    store.close();
  });

  test("empty query returns empty results", () => {
    const store = createStore();
    store.index({
      content: "# Doc\n\nContent.",
      source: "empty-q",
    });
    const results = store.search("", 3);
    assert.equal(results.length, 0, "Empty query should return no results");
    store.close();
  });
});

describe("Edge Cases", () => {
  test("content with no headings creates single chunk", () => {
    const store = createStore();
    const result = store.index({
      content: "Just plain text without any markdown headings.",
      source: "plain",
    });
    assert.equal(result.totalChunks, 1);
    store.close();
  });

  test("nested code blocks (triple backtick inside fenced)", () => {
    const store = createStore();
    const content =
      '# Example\n\n````markdown\n```javascript\nconsole.log("nested");\n```\n````';
    const result = store.index({ content, source: "nested" });
    assert.ok(result.totalChunks >= 1);
    assert.ok(result.codeChunks >= 1);

    const results = store.search("nested console", 1);
    assert.ok(results.length > 0);
    assert.ok(results[0].content.includes("nested"), "Nested code preserved");
    store.close();
  });

  test("very long content chunks correctly", () => {
    const store = createStore();
    const sections = Array.from(
      { length: 20 },
      (_, i) => `## Section ${i}\n\nContent for section ${i}.\n`,
    ).join("\n");
    const result = store.index({
      content: sections,
      source: "long-doc",
    });
    assert.equal(
      result.totalChunks,
      20,
      `Expected 20 chunks, got ${result.totalChunks}`,
    );
    store.close();
  });

  test("heading-only content (no body) still creates chunk", () => {
    const store = createStore();
    const result = store.index({
      content: "# Title Only\n\n## Another Heading",
      source: "headings-only",
    });
    // The heading lines themselves are content
    assert.ok(result.totalChunks >= 1);
    store.close();
  });
});

describe("Source-Scoped Search", () => {
  test("search with source filter returns only matching source", () => {
    const store = createStore();
    store.index({
      content: "# Zod Transform\n\nUse .transform() to map values.\n\n## Refine\n\nUse .refine() for custom validation.",
      source: "Zod API docs",
    });
    store.index({
      content: "# Security Release\n\nCVE-2025-1234: Fixed transform injection vulnerability.\n\n## Fixes\n\nRefine permission checks.",
      source: "Node.js v22 CHANGELOG",
    });

    // Without source filter — both sources may match (OR mode for cross-chunk terms)
    const allResults = store.search("transform refine", 5, undefined, "OR");
    assert.ok(allResults.length >= 2, "Should find results from both sources");

    // With source filter — only Zod
    const zodResults = store.search("transform refine", 5, "Zod", "OR");
    assert.ok(zodResults.length > 0, "Should find Zod results");
    assert.ok(
      zodResults.every((r) => r.source.includes("Zod")),
      `All results should be from Zod, got: ${zodResults.map((r) => r.source).join(", ")}`,
    );

    // With source filter — only Node.js
    const nodeResults = store.search("transform refine", 5, "Node.js", "OR");
    assert.ok(nodeResults.length > 0, "Should find Node.js results");
    assert.ok(
      nodeResults.every((r) => r.source.includes("Node.js")),
      `All results should be from Node.js, got: ${nodeResults.map((r) => r.source).join(", ")}`,
    );

    store.close();
  });

  test("search with non-matching source returns empty", () => {
    const store = createStore();
    store.index({
      content: "# React Hooks\n\nuseEffect for side effects.",
      source: "React docs",
    });
    const results = store.search("useEffect", 3, "Vue");
    assert.equal(results.length, 0, "Should return empty for non-matching source");
    store.close();
  });

  test("listSources returns all indexed sources", () => {
    const store = createStore();
    store.index({ content: "# A\n\nContent A.", source: "Source A" });
    store.index({ content: "# B\n\nContent B.", source: "Source B" });
    store.index({ content: "# C\n\nContent C.", source: "Source C" });

    const sources = store.listSources();
    assert.equal(sources.length, 3, `Expected 3 sources, got ${sources.length}`);
    const labels = sources.map((s) => s.label);
    assert.ok(labels.includes("Source A"));
    assert.ok(labels.includes("Source B"));
    assert.ok(labels.includes("Source C"));
    assert.ok(sources.every((s) => s.chunkCount >= 1));
    store.close();
  });

  test("source filter uses partial match (LIKE)", () => {
    const store = createStore();
    store.index({ content: "# Config\n\nDatabase config.", source: "Node.js v22 CHANGELOG" });
    store.index({ content: "# Config\n\nApp config.", source: "Zod API docs" });

    // Partial match "v22" should match "Node.js v22 CHANGELOG"
    const results = store.search("config", 5, "v22");
    assert.ok(results.length > 0, "Partial source match should work");
    assert.ok(
      results.every((r) => r.source.includes("v22")),
      "Should only return v22 source",
    );
    store.close();
  });
});

describe("Context Savings Measurement", () => {
  test("index+search uses less context than raw content", () => {
    const store = createStore();
    const content = readFileSync(
      join(fixtureDir, "context7-react-docs.md"),
      "utf-8",
    );
    const rawBytes = Buffer.byteLength(content);

    store.index({ content, source: "React docs" });

    // Search returns only relevant chunk, not full doc
    const results = store.search("useEffect cleanup", 1);
    assert.ok(results.length > 0);

    const resultBytes = Buffer.byteLength(
      results.map((r) => `${r.title}\n${r.content}`).join("\n"),
    );
    assert.ok(
      resultBytes < rawBytes,
      "Search result should be smaller than full doc",
    );
    store.close();
  });
});

describe("Plain Text Indexing", () => {
  test("indexPlainText: chunks by line groups", () => {
    const store = createStore();
    const lines = Array.from({ length: 100 }, (_, i) => `Log line ${i + 1}: processing request`).join("\n");
    const result = store.indexPlainText(lines, "build-output");
    assert.ok(result.totalChunks >= 5, `Expected >=5 chunks for 100 lines with 20-line groups, got ${result.totalChunks}`);
    assert.equal(result.label, "build-output");
    assert.equal(result.codeChunks, 0);
    store.close();
  });

  test("indexPlainText: single chunk for small output", () => {
    const store = createStore();
    const content = "Line 1\nLine 2\nLine 3";
    const result = store.indexPlainText(content, "small-output");
    assert.equal(result.totalChunks, 1, `Expected 1 chunk for 3 lines, got ${result.totalChunks}`);
    assert.equal(result.label, "small-output");
    store.close();
  });

  test("indexPlainText: blank-line splitting for sectioned output", () => {
    const store = createStore();
    const content = [
      "Section A line 1\nSection A line 2",
      "Section B line 1\nSection B line 2",
      "Section C line 1\nSection C line 2",
    ].join("\n\n");
    const result = store.indexPlainText(content, "sectioned-output");
    assert.equal(result.totalChunks, 3, `Expected 3 chunks for 3 blank-line-separated sections, got ${result.totalChunks}`);
    store.close();
  });

  test("indexPlainText: searchable after indexing", () => {
    const store = createStore();
    const lines = Array.from({ length: 200 }, (_, i) => {
      if (i === 149) return "ERROR: connection refused to database host";
      return `[INFO] ${i + 1}: normal operation continued`;
    }).join("\n");
    store.indexPlainText(lines, "server-logs");
    const results = store.search("connection refused", 3);
    assert.ok(results.length > 0, "Should find the error line via search");
    assert.ok(
      results[0].content.includes("connection refused"),
      `Result should contain 'connection refused', got: ${results[0].content.slice(0, 100)}`,
    );
    store.close();
  });

  test("indexPlainText: empty content returns 0 chunks", () => {
    const store = createStore();
    const result = store.indexPlainText("", "empty-output");
    assert.equal(result.totalChunks, 0, "Empty content should produce 0 chunks");
    assert.equal(result.label, "empty-output");
    store.close();
  });

  test("indexPlainText: in-memory store works", () => {
    const store = new ContentStore(":memory:");
    const content = "Line 1\nLine 2\nLine 3";
    const result = store.indexPlainText(content, "memory-test");
    assert.equal(result.totalChunks, 1);
    assert.equal(result.label, "memory-test");

    const searchResults = store.search("Line 1", 1);
    assert.ok(searchResults.length > 0, "In-memory store should support search");
    assert.ok(searchResults[0].content.includes("Line 1"));
    store.close();
  });
});

describe("getDistinctiveTerms", () => {
  test("getDistinctiveTerms: returns terms in moderate frequency range", () => {
    const store = createStore();
    // Create content with 10 sections. A distinctive term appears in 3-4 sections
    // (i.e., >= 2 and <= 40% of 10 = 4).
    const sections = Array.from({ length: 10 }, (_, i) => {
      const base = `## Section ${i}\n\nGeneric content for section number ${i}.`;
      if (i < 3) return `${base}\n\nThe authentication middleware validates tokens.`;
      if (i < 5) return `${base}\n\nThe database connection pool handles queries.`;
      return `${base}\n\nPlain filler paragraph without special keywords.`;
    }).join("\n\n");
    const result = store.indexPlainText(sections, "distinctive-moderate");
    const terms = store.getDistinctiveTerms(result.sourceId);
    assert.ok(Array.isArray(terms), "Should return an array");
    assert.ok(terms.length > 0, `Should return some distinctive terms, got ${terms.length}`);
    // "authentication" appears in 3/10 sections — should be distinctive
    assert.ok(
      terms.includes("authentication"),
      `Expected 'authentication' in distinctive terms, got: ${terms.join(", ")}`,
    );
    store.close();
  });

  test("getDistinctiveTerms: returns empty for too few sections", () => {
    const store = createStore();
    // Only 2 sections — below the chunk_count < 3 threshold
    const content = "Section A content here.\n\nSection B content here.";
    const result = store.indexPlainText(content, "too-few-sections");
    assert.ok(result.totalChunks <= 2, `Expected <=2 chunks, got ${result.totalChunks}`);
    const terms = store.getDistinctiveTerms(result.sourceId);
    assert.deepEqual(terms, [], "Should return empty array for fewer than 3 chunks");
    store.close();
  });

  test("getDistinctiveTerms: excludes stopwords", () => {
    const store = createStore();
    // Create 5 sections where stopwords "the", "this", "that", "with" appear in every section.
    // "encryption" appears in 2 sections (moderate frequency).
    const sections = Array.from({ length: 5 }, (_, i) => {
      const base = `## Part ${i}\n\nThis is the content that comes with part number ${i}.`;
      if (i < 2) return `${base}\n\nEncryption algorithms protect the data.`;
      return base;
    }).join("\n\n");
    const result = store.indexPlainText(sections, "stopwords-test");
    const terms = store.getDistinctiveTerms(result.sourceId);
    // Stopwords should never appear
    const stopwords = ["the", "this", "that", "with", "for", "and"];
    for (const sw of stopwords) {
      assert.ok(
        !terms.includes(sw),
        `Stopword '${sw}' should not be in distinctive terms`,
      );
    }
    // "encryption" appears in 2/5 sections — should qualify
    assert.ok(
      terms.includes("encryption"),
      `Expected 'encryption' in terms, got: ${terms.join(", ")}`,
    );
    store.close();
  });
});

describe("Smart Chunk Titles", () => {
  test("smart chunk titles: blank-line split uses first line as title", () => {
    const store = createStore();
    // 4 blank-line-separated sections with meaningful first lines
    const content = [
      "v2.3.0 - Performance improvements\nFixed memory leak in connection pool\nReduced startup time by 40%",
      "v2.2.1 - Security patch\nPatched XSS vulnerability in template engine\nUpdated dependencies",
      "v2.2.0 - New features\nAdded WebSocket support\nNew configuration API",
      "v2.1.0 - Bug fixes\nFixed race condition in worker threads\nImproved error messages",
    ].join("\n\n");
    store.indexPlainText(content, "changelog-sections");

    // Search for a term in the first section
    const results = store.search("memory leak connection pool", 1);
    assert.ok(results.length > 0, "Should find the section");
    assert.ok(
      results[0].title.startsWith("v2.3.0"),
      `Title should be first line 'v2.3.0 - Performance improvements', got: '${results[0].title}'`,
    );
    // Should NOT be a generic "Section N" title
    assert.ok(
      !results[0].title.startsWith("Section"),
      `Title should not be generic 'Section N', got: '${results[0].title}'`,
    );

    // Verify another section too
    const results2 = store.search("XSS vulnerability template", 1);
    assert.ok(results2.length > 0, "Should find second section");
    assert.ok(
      results2[0].title.startsWith("v2.2.1"),
      `Title should be 'v2.2.1 - Security patch', got: '${results2[0].title}'`,
    );
    store.close();
  });

  test("smart chunk titles: line-group chunks use first line as title", () => {
    const store = createStore();
    // Create enough lines (>20) to trigger line-group chunking (not blank-line splitting)
    // by making it a single block of lines with no blank-line sections
    const lines = Array.from({ length: 60 }, (_, i) => {
      if (i === 0) return "ERROR: Failed to compile module 'auth-service'";
      if (i === 20) return "WARNING: Deprecated API usage in routes/v2.ts";
      if (i === 40) return "INFO: Build completed with 2 warnings";
      return `[LOG] Step ${i}: processing task ${i}`;
    });
    const content = lines.join("\n");
    store.indexPlainText(content, "build-log");

    // Search for content in the first chunk
    const results = store.search("Failed compile auth-service", 1);
    assert.ok(results.length > 0, "Should find the first chunk");
    assert.ok(
      results[0].title.includes("ERROR"),
      `Title should be first line of chunk containing 'ERROR', got: '${results[0].title}'`,
    );
    // Should NOT be a generic "Lines N-M" title
    assert.ok(
      !results[0].title.startsWith("Lines"),
      `Title should not be generic 'Lines N-M', got: '${results[0].title}'`,
    );
    store.close();
  });
});

describe("DB Cleanup", () => {
  test("cleanupStaleDBs removes files for dead PIDs", () => {
    const fakePid = 99999;
    const fakePath = join(tmpdir(), `context-mode-${fakePid}.db`);
    writeFileSync(fakePath, "fake");
    writeFileSync(fakePath + "-wal", "fake");
    writeFileSync(fakePath + "-shm", "fake");

    const cleaned = cleanupStaleDBs();
    assert.ok(cleaned >= 1, `Should clean at least 1 file, cleaned ${cleaned}`);
    assert.ok(!existsSync(fakePath), "DB file should be removed");
    assert.ok(!existsSync(fakePath + "-wal"), "WAL file should be removed");
    assert.ok(!existsSync(fakePath + "-shm"), "SHM file should be removed");
  });

  test("cleanupStaleDBs does not remove current process DB", () => {
    const myPath = join(tmpdir(), `context-mode-${process.pid}.db`);
    writeFileSync(myPath, "current");

    cleanupStaleDBs();
    assert.ok(existsSync(myPath), "Current process DB should NOT be removed");

    // Clean up manually
    try { require("fs").unlinkSync(myPath); } catch {}
  });

  test("store.cleanup() removes own DB and WAL/SHM files", () => {
    const store = createStore();
    // Index something to generate WAL activity
    store.index({ content: "# Test\n\nCleanup test content.", source: "cleanup-test" });

    // Get the DB path by creating a known-path store
    const knownPath = join(tmpdir(), `context-mode-cleanup-test-${Date.now()}.db`);
    const knownStore = new ContentStore(knownPath);
    knownStore.index({ content: "# Data\n\nSome data.", source: "known" });

    assert.ok(existsSync(knownPath), "DB should exist before cleanup");

    knownStore.cleanup();
    assert.ok(!existsSync(knownPath), "DB should be removed after cleanup");
    assert.ok(!existsSync(knownPath + "-wal"), "WAL should be removed after cleanup");
    assert.ok(!existsSync(knownPath + "-shm"), "SHM should be removed after cleanup");

    store.close();
  });

  test("store.cleanup() is safe to call multiple times", () => {
    const path = join(tmpdir(), `context-mode-cleanup-idempotent-${Date.now()}.db`);
    const store = new ContentStore(path);
    store.cleanup();
    // Second call should not throw
    assert.doesNotThrow(() => store.cleanup());
  });
});

describe("Max Chunk Size", () => {
  test("splits oversized markdown chunk at paragraph boundaries", () => {
    const store = createStore();
    const paragraphs = Array.from({ length: 20 }, (_, i) =>
      `Paragraph ${i + 1}. ${"Lorem ipsum dolor sit amet. ".repeat(20)}`
    );
    const content = `# Big Section\n\n${paragraphs.join("\n\n")}`;

    const result = store.index({ content, source: "max-chunk-test" });
    assert.ok(result.totalChunks > 1, `Expected >1 chunk, got ${result.totalChunks}`);

    const searchResult = store.search("Paragraph", 10, "max-chunk-test");
    for (const r of searchResult) {
      assert.ok(r.title.includes("Big Section"), `Expected heading in title, got: ${r.title}`);
    }
    store.close();
  });

  test("does not split chunks already under maxChunkBytes", () => {
    const store = createStore();
    const content = `# Small Section\n\nJust a few lines of text.\n\nAnother paragraph.`;
    const result = store.index({ content, source: "small-chunk-test" });
    assert.equal(result.totalChunks, 1);
    store.close();
  });

  test("keeps code blocks intact when splitting oversized chunks", () => {
    const store = createStore();
    const codeBlock = "```typescript\n" + "const x = 1;\n".repeat(100) + "```";
    const prose = Array.from({ length: 10 }, (_, i) =>
      `Paragraph ${i}. ${"Text content here. ".repeat(20)}`
    ).join("\n\n");
    const content = `# Code Section\n\n${codeBlock}\n\n${prose}`;

    const result = store.index({ content, source: "code-chunk-test" });
    assert.ok(result.totalChunks >= 2, `Expected >=2 chunks, got ${result.totalChunks}`);

    const codeResults = store.search("const x", 5, "code-chunk-test");
    assert.ok(codeResults.length > 0, "Should find the code block");
    assert.ok(
      codeResults[0].content.includes("```typescript"),
      "Code block should be intact with opening fence",
    );
    store.close();
  });
});

describe("JSON Chunking (Objects)", () => {
  test("chunks JSON object by top-level keys", () => {
    const store = createStore();
    const json = JSON.stringify({
      authentication: {
        oauth: { clientId: "abc", scopes: ["read", "write"] },
        jwt: { algorithm: "RS256", expiry: "1h" },
      },
      database: {
        host: "localhost",
        port: 5432,
      },
    });

    const result = store.indexJSON(json, "config");
    assert.ok(result.totalChunks >= 2, `Expected >=2 chunks, got ${result.totalChunks}`);

    const authResults = store.search("oauth clientId", 5, "config");
    assert.ok(authResults.length > 0, "Should find oauth config");
    assert.ok(
      authResults[0].title.includes("authentication"),
      `Expected 'authentication' in title, got: ${authResults[0].title}`,
    );
    store.close();
  });

  test("small JSON object becomes single chunk", () => {
    const store = createStore();
    const json = JSON.stringify({ name: "Alice", role: "admin" });
    const result = store.indexJSON(json, "small");
    assert.equal(result.totalChunks, 1);
    store.close();
  });

  test("chunks nested JSON with path titles", () => {
    const store = createStore();
    const endpoints: Record<string, unknown> = {};
    for (let i = 0; i < 30; i++) {
      endpoints[`/api/v1/resource${i}`] = {
        method: "GET",
        description: `Get resource ${i}. ${"Details. ".repeat(50)}`,
        params: { id: "string", limit: "number" },
      };
    }
    const json = JSON.stringify({ endpoints });

    const result = store.indexJSON(json, "api-spec");
    assert.ok(result.totalChunks > 1, `Expected >1 chunk, got ${result.totalChunks}`);

    const results = store.search("resource15", 5, "api-spec");
    assert.ok(results.length > 0, "Should find resource15");
    store.close();
  });

  test("handles invalid JSON gracefully by falling back to plain text", () => {
    const store = createStore();
    const result = store.indexJSON("not valid json {{{", "bad-json");
    assert.ok(result.totalChunks >= 1, "Should still index as plain text");
    store.close();
  });
});

describe("JSON Chunking (Arrays)", () => {
  test("top-level array of objects uses identity field in titles", () => {
    const store = createStore();
    const users = Array.from({ length: 50 }, (_, i) => ({
      id: i + 1,
      name: `User ${i + 1}`,
      email: `user${i + 1}@example.com`,
      bio: `Bio for user ${i + 1}. ${"Some details. ".repeat(10)}`,
    }));
    const json = JSON.stringify(users);

    const result = store.indexJSON(json, "users-api");
    assert.ok(result.totalChunks > 1, `Expected >1 chunk, got ${result.totalChunks}`);

    const results = store.search("User 25", 5, "users-api");
    assert.ok(results.length > 0, "Should find User 25");
    store.close();
  });

  test("identity field appears in chunk titles", () => {
    const store = createStore();
    const items = [
      { name: "Alice", role: "admin", data: "x".repeat(2000) },
      { name: "Bob", role: "user", data: "y".repeat(2000) },
      { name: "Carol", role: "user", data: "z".repeat(2000) },
    ];
    const json = JSON.stringify(items);

    const result = store.indexJSON(json, "people");
    assert.ok(result.totalChunks >= 2, `Expected >=2 chunks, got ${result.totalChunks}`);

    const results = store.search("Alice admin", 5, "people");
    assert.ok(results.length > 0, "Should find Alice");
    assert.ok(
      results[0].title.includes("Alice"),
      `Expected 'Alice' in title, got: ${results[0].title}`,
    );
    store.close();
  });

  test("array of primitives becomes batched chunks", () => {
    const store = createStore();
    const longStrings = Array.from({ length: 100 }, (_, i) =>
      `Item ${i}: ${"content ".repeat(50)}`
    );
    const json = JSON.stringify(longStrings);

    const result = store.indexJSON(json, "primitives");
    assert.ok(result.totalChunks >= 2, `Expected >=2 chunks, got ${result.totalChunks}`);
    store.close();
  });

  test("nested array within object uses full key path", () => {
    const store = createStore();
    const json = JSON.stringify({
      api: {
        endpoints: Array.from({ length: 20 }, (_, i) => ({
          path: `/api/v1/resource${i}`,
          method: "GET",
          description: `Resource ${i}. ${"Details ".repeat(30)}`,
        })),
      },
    });

    const result = store.indexJSON(json, "nested-api");
    assert.ok(result.totalChunks > 1, `Expected >1 chunk, got ${result.totalChunks}`);

    const results = store.search("resource10", 5, "nested-api");
    assert.ok(results.length > 0, "Should find resource10");
    assert.ok(
      results[0].title.includes("api") && results[0].title.includes("endpoints"),
      `Expected path in title, got: ${results[0].title}`,
    );
    store.close();
  });
});

describe("Content-Type Routing", () => {
  test("indexJSON produces searchable chunks from pretty-printed JSON", () => {
    const store = createStore();
    const apiResponse = JSON.stringify({
      data: {
        users: [
          { id: 1, name: "Alice", email: "alice@example.com" },
          { id: 2, name: "Bob", email: "bob@example.com" },
        ],
        pagination: { page: 1, total: 100 },
      },
    });

    const result = store.indexJSON(apiResponse, "api-response");
    assert.ok(result.totalChunks >= 1, `Expected >=1 chunks, got ${result.totalChunks}`);

    const results = store.search("Alice email", 5, "api-response");
    assert.ok(results.length > 0, "Should find Alice's email via search");
    store.close();
  });

  test("indexPlainText handles non-JSON non-HTML content", () => {
    const store = createStore();
    const plainText = "name,email,role\nAlice,alice@example.com,admin\nBob,bob@example.com,user";
    const result = store.indexPlainText(plainText, "csv-response");
    assert.ok(result.totalChunks >= 1);
    store.close();
  });
});

// ── Source metadata & TTL cache ───────────────────────────────────────

describe("Source metadata (TTL cache)", () => {
  test("getSourceMeta returns null for unknown source", () => {
    const store = createStore();
    const meta = store.getSourceMeta("nonexistent-source");
    expect(meta).toBeNull();
    store.close();
  });

  test("getSourceMeta returns metadata after indexing", () => {
    const store = createStore();
    store.index({ content: "# Hello\nWorld", source: "test-doc" });
    const meta = store.getSourceMeta("test-doc");
    expect(meta).not.toBeNull();
    expect(meta!.label).toBe("test-doc");
    expect(meta!.chunkCount).toBeGreaterThan(0);
    expect(meta!.indexedAt).toBeTruthy();
    store.close();
  });

  test("getSourceMeta indexedAt is valid datetime", () => {
    const store = createStore();
    store.index({ content: "# Test\nContent here", source: "datetime-test" });
    const meta = store.getSourceMeta("datetime-test");
    const parsed = new Date(meta!.indexedAt);
    expect(parsed.getTime()).not.toBeNaN();
    store.close();
  });

  test("getSourceMeta updates after re-indexing same source", () => {
    const store = createStore();
    store.index({ content: "# V1\nFirst version", source: "evolving-doc" });
    const meta1 = store.getSourceMeta("evolving-doc");
    store.index({ content: "# V2\nSecond version\n## Extra\nMore content", source: "evolving-doc" });
    const meta2 = store.getSourceMeta("evolving-doc");
    expect(meta2!.chunkCount).toBeGreaterThanOrEqual(meta1!.chunkCount);
    store.close();
  });
});

// ── Persistent content store lifecycle ────────────────────────────────

describe("Persistent content store lifecycle", () => {
  test("cleanupStaleSources keeps recent sources and returns 0", () => {
    const store = createStore();
    store.index({ content: "# Fresh doc\nContent", source: "fresh-source" });
    const deleted = store.cleanupStaleSources(30);
    expect(typeof deleted).toBe("number");
    expect(deleted).toBe(0);
    const meta = store.getSourceMeta("fresh-source");
    expect(meta).not.toBeNull();
    expect(meta!.label).toBe("fresh-source");
    store.close();
  });

  test("cleanupStaleSources returns number type", () => {
    const store = createStore();
    store.index({ content: "# Test\nContent", source: "test-source" });
    const deleted = store.cleanupStaleSources(365);
    expect(typeof deleted).toBe("number");
    store.close();
  });

  test("cleanupStaleSources deletes aged sources without breaking later search or reindex", () => {
    const store = createStore();
    store.index({ content: "# Old\nlegacy token", source: "old-source" });
    store.index({ content: "# Fresh\nfresh token", source: "fresh-source" });
    store.exec("UPDATE sources SET indexed_at = datetime('now', '-90 days') WHERE label = 'old-source'");

    const deleted = store.cleanupStaleSources(30);
    expect(deleted).toBe(1);
    expect(store.getSourceMeta("old-source")).toBeNull();
    expect(store.getSourceMeta("fresh-source")).not.toBeNull();

    const freshResults = store.search("fresh token", 3, "fresh-source");
    expect(freshResults.length).toBeGreaterThan(0);

    store.index({ content: "# Reborn\nold source restored", source: "old-source" });
    const rebornResults = store.search("restored", 3, "old-source");
    expect(rebornResults.length).toBeGreaterThan(0);
    store.close();
  });

  test("repeated multi-chunk reindex keeps search healthy", () => {
    const store = createStore();
    const makeDoc = (version: number) =>
      Array.from({ length: 24 }, (_, i) =>
        `## Section ${version}-${i}\n\nRepeated reindex token ${version}-${i}\n\nLine A\nLine B`,
      ).join("\n\n");

    for (let version = 1; version <= 8; version++) {
      store.index({
        content: `# Large Doc ${version}\n\n${makeDoc(version)}`,
        source: "reindex-stress",
      });
    }

    const results = store.search("Repeated reindex token 8-12", 5, "reindex-stress");
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]!.source).toBe("reindex-stress");
    store.close();
  });

  test("getDBSizeBytes returns positive number after indexing", () => {
    const store = createStore();
    store.index({ content: "# Test\nSome content for size", source: "size-test" });
    const size = store.getDBSizeBytes();
    expect(size).toBeGreaterThan(0);
    store.close();
  });

  test("store data persists after close and reopen at same path", () => {
    const dbPath = join(tmpdir(), `persist-test-${Date.now()}.db`);
    const store1 = new ContentStore(dbPath);
    store1.index({ content: "# Persistent\nThis should survive", source: "persist-doc" });
    store1.close();

    const store2 = new ContentStore(dbPath);
    const meta = store2.getSourceMeta("persist-doc");
    expect(meta).not.toBeNull();
    expect(meta!.label).toBe("persist-doc");
    expect(meta!.chunkCount).toBeGreaterThan(0);
    store2.cleanup();
  });

  test("deleting DB file before creating store gives fresh state", () => {
    const dbPath = join(tmpdir(), `fresh-test-${Date.now()}.db`);
    const store1 = new ContentStore(dbPath);
    store1.index({ content: "# Old\nOld content", source: "old-doc" });
    store1.close();

    for (const suffix of ["", "-wal", "-shm"]) {
      try { unlinkSync(dbPath + suffix); } catch { /* ignore */ }
    }

    const store2 = new ContentStore(dbPath);
    const meta = store2.getSourceMeta("old-doc");
    expect(meta).toBeNull();
    store2.cleanup();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// SQLITE_BUSY Retry Logic (#218)
// ═══════════════════════════════════════════════════════════════════════════

describe("SQLITE_BUSY retry logic", () => {
  test("SQLiteBase uses 30s timeout", () => {
    const dbBaseSrc = readFileSync(
      join(__dirname, "../src/db-base.ts"),
      "utf-8",
    );
    expect(dbBaseSrc).toContain("timeout: 30000");
  });

  test("withRetry retries on SQLITE_BUSY and succeeds", () => {
    let attempts = 0;
    const result = withRetry(() => {
      attempts++;
      if (attempts < 3) {
        throw new Error("SQLITE_BUSY: database is locked");
      }
      return "success";
    }, [0, 0, 0]);
    expect(result).toBe("success");
    expect(attempts).toBe(3);
  });

  test("withRetry throws after max retries exhausted", () => {
    expect(() => {
      withRetry(() => {
        throw new Error("SQLITE_BUSY: database is locked");
      }, [0, 0, 0]);
    }).toThrow(/SQLITE_BUSY.*3 retries/);
  });

  test("withRetry retries on SQLITE_BUSY with zero delays", () => {
    let attempts = 0;
    const result = withRetry(() => {
      attempts++;
      if (attempts < 3) {
        throw new Error("SQLITE_BUSY: database is locked");
      }
      return "ok";
    }, [0, 0, 0]);
    expect(result).toBe("ok");
    expect(attempts).toBe(3);
  });

  test("withRetry throws after all retries with zero delays", () => {
    expect(() => {
      withRetry(() => {
        throw new Error("database is locked");
      }, [0, 0, 0]);
    }).toThrow(/SQLITE_BUSY.*3 retries/);
  });

  test("withRetry rethrows non-BUSY errors immediately", () => {
    let attempts = 0;
    expect(() => {
      withRetry(() => {
        attempts++;
        throw new Error("UNIQUE constraint failed");
      }, [0, 0, 0]);
    }).toThrow("UNIQUE constraint failed");
    expect(attempts).toBe(1);
  });
});
