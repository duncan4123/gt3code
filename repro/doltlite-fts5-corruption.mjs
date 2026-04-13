#!/usr/bin/env node

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const ROOT = "/data/projects/claude-context-mode";
const DOLTLITE = "/data/projects/doltlite-latest/build/doltlite";
const SQLITE3 = "/usr/bin/sqlite3";
const MAX_CHUNK_BYTES = 4096;

const INPUTS = [
  "src/db-base.ts",
  "src/runtime.ts",
  "src/session/extract.ts",
  "src/session/snapshot.ts",
];

function sqlString(text) {
  return `'${text.replace(/'/g, "''")}'`;
}

function buildTitle(headingStack, currentHeading) {
  const titles = headingStack.map((h) => h.text);
  return titles.length ? titles.join(" > ") : (currentHeading || "untitled");
}

function chunkMarkdown(text, maxChunkBytes = MAX_CHUNK_BYTES) {
  const chunks = [];
  const lines = text.split("\n");
  const headingStack = [];
  let currentContent = [];
  let currentHeading = "";

  const flush = () => {
    const joined = currentContent.join("\n").trim();
    if (!joined) return;

    const title = buildTitle(headingStack, currentHeading);
    const hasCode = currentContent.some((l) => /^`{3,}/.test(l));

    if (Buffer.byteLength(joined) <= maxChunkBytes) {
      chunks.push({ title, content: joined, hasCode });
      currentContent = [];
      return;
    }

    const paragraphs = joined.split(/\n\n+/);
    let accumulator = [];
    let partIndex = 1;

    const flushAccumulator = () => {
      if (accumulator.length === 0) return;
      const part = accumulator.join("\n\n").trim();
      if (!part) return;
      const partTitle = paragraphs.length > 1 ? `${title} (${partIndex})` : title;
      partIndex++;
      chunks.push({
        title: partTitle,
        content: part,
        hasCode: part.includes("```"),
      });
      accumulator = [];
    };

    for (const para of paragraphs) {
      accumulator.push(para);
      const candidate = accumulator.join("\n\n");
      if (Buffer.byteLength(candidate) > maxChunkBytes && accumulator.length > 1) {
        accumulator.pop();
        flushAccumulator();
        accumulator = [para];
      }
    }
    flushAccumulator();
    currentContent = [];
  };

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    if (/^[-_*]{3,}\s*$/.test(line)) {
      flush();
      i++;
      continue;
    }

    const headingMatch = line.match(/^(#{1,4})\s+(.+)$/);
    if (headingMatch) {
      flush();
      const level = headingMatch[1].length;
      const heading = headingMatch[2].trim();
      while (headingStack.length > 0 && headingStack[headingStack.length - 1].level >= level) {
        headingStack.pop();
      }
      headingStack.push({ level, text: heading });
      currentHeading = heading;
      currentContent.push(line);
      i++;
      continue;
    }

    const codeMatch = line.match(/^(`{3,})(.*)?$/);
    if (codeMatch) {
      const fence = codeMatch[1];
      const codeLines = [line];
      i++;
      while (i < lines.length) {
        codeLines.push(lines[i]);
        if (lines[i].startsWith(fence) && lines[i].trim() === fence) {
          i++;
          break;
        }
        i++;
      }
      currentContent.push(...codeLines);
      continue;
    }

    currentContent.push(line);
    i++;
  }

  flush();
  return chunks;
}

function buildFixture() {
  const lines = [
    ".bail on",
    "CREATE VIRTUAL TABLE chunks USING fts5(",
    "  title,",
    "  content,",
    "  source_id UNINDEXED,",
    "  content_type UNINDEXED,",
    "  tokenize='porter unicode61'",
    ");",
  ];

  for (const [fileIndex, rel] of INPUTS.entries()) {
    const text = readFileSync(resolve(ROOT, rel), "utf8");
    const chunks = chunkMarkdown(text);
    lines.push(`-- ${rel}: ${chunks.length} chunks`);
    for (const [chunkIndex, chunk] of chunks.entries()) {
      const rowid = (fileIndex + 1) * 1_000_000 + chunkIndex + 1;
      const sourceId = fileIndex + 1;
      const contentType = chunk.hasCode ? "code" : "prose";
      lines.push(
        `INSERT INTO chunks (rowid, title, content, source_id, content_type) VALUES (` +
        `${rowid}, ${sqlString(chunk.title)}, ${sqlString(chunk.content)}, ${sourceId}, ${sqlString(contentType)});`,
      );
    }
  }

  lines.push("SELECT count(*) FROM chunks;");
  return lines.join("\n") + "\n";
}

function runEngine(binary, dbPath, fixturePath) {
  return spawnSync(binary, [dbPath], {
    input: readFileSync(fixturePath, "utf8"),
    encoding: "utf8",
  });
}

function main() {
  const tmp = mkdtempSync(join(tmpdir(), "doltlite-fts5-repro-"));
  const fixturePath = join(tmp, "fixture.sql");
  const stockDb = join(tmp, "stock.db");
  const doltDb = join(tmp, "doltlite.db");

  try {
    const fixture = buildFixture();
    writeFileSync(fixturePath, fixture);

    const stock = runEngine(SQLITE3, stockDb, fixturePath);
    const dolt = runEngine(DOLTLITE, doltDb, fixturePath);

    const summary = {
      fixturePath,
      inputs: INPUTS,
      stock: {
        binary: SQLITE3,
        status: stock.status,
        stdout: stock.stdout.trim(),
        stderr: stock.stderr.trim(),
      },
      doltlite: {
        binary: DOLTLITE,
        status: dolt.status,
        stdout: dolt.stdout.trim(),
        stderr: dolt.stderr.trim(),
      },
    };

    console.log(JSON.stringify(summary, null, 2));

    if (stock.status !== 0) process.exit(stock.status ?? 1);
    if (dolt.status === 0) {
      console.error("Expected DoltLite repro to fail, but it passed.");
      process.exit(1);
    }
  } finally {
    if (!process.argv.includes("--keep")) {
      rmSync(tmp, { recursive: true, force: true });
    }
  }
}

main();
