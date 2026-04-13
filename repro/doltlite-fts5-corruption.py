#!/usr/bin/env python3

from __future__ import annotations

import os
import sqlite3
from pathlib import Path

ROOT = Path("/data/projects/claude-context-mode")
MAX_CHUNK_BYTES = 4096
INPUTS = [
    "src/db-base.ts",
    "src/runtime.ts",
    "src/session/extract.ts",
    "src/session/snapshot.ts",
]


def build_title(heading_stack: list[dict[str, object]], current_heading: str) -> str:
    titles = [str(h["text"]) for h in heading_stack]
    return " > ".join(titles) if titles else (current_heading or "untitled")


def chunk_markdown(text: str, max_chunk_bytes: int = MAX_CHUNK_BYTES) -> list[dict[str, object]]:
    chunks: list[dict[str, object]] = []
    lines = text.split("\n")
    heading_stack: list[dict[str, object]] = []
    current_content: list[str] = []
    current_heading = ""

    def flush() -> None:
        nonlocal current_content
        joined = "\n".join(current_content).strip()
        if not joined:
            return

        title = build_title(heading_stack, current_heading)
        has_code = any(line.startswith("```") for line in current_content)

        if len(joined.encode("utf-8")) <= max_chunk_bytes:
            chunks.append({"title": title, "content": joined, "has_code": has_code})
            current_content = []
            return

        paragraphs = joined.split("\n\n")
        accumulator: list[str] = []
        part_index = 1

        def flush_accumulator() -> None:
            nonlocal accumulator, part_index
            if not accumulator:
                return
            part = "\n\n".join(accumulator).strip()
            if not part:
                return
            part_title = f"{title} ({part_index})" if len(paragraphs) > 1 else title
            part_index += 1
            chunks.append(
                {
                    "title": part_title,
                    "content": part,
                    "has_code": "```" in part,
                }
            )
            accumulator = []

        for para in paragraphs:
            accumulator.append(para)
            candidate = "\n\n".join(accumulator)
            if len(candidate.encode("utf-8")) > max_chunk_bytes and len(accumulator) > 1:
                accumulator.pop()
                flush_accumulator()
                accumulator = [para]

        flush_accumulator()
        current_content = []

    i = 0
    while i < len(lines):
        line = lines[i]

        if line and set(line) <= {"-", "_", "*"} and len(line) >= 3:
            flush()
            i += 1
            continue

        if line.startswith("#"):
            level = 0
            while level < len(line) and line[level] == "#":
                level += 1
            if 1 <= level <= 4 and len(line) > level and line[level] == " ":
                flush()
                heading = line[level + 1 :].strip()
                while heading_stack and int(heading_stack[-1]["level"]) >= level:
                    heading_stack.pop()
                heading_stack.append({"level": level, "text": heading})
                current_heading = heading
                current_content.append(line)
                i += 1
                continue

        if line.startswith("```"):
            fence = line.strip()
            code_lines = [line]
            i += 1
            while i < len(lines):
                code_lines.append(lines[i])
                if lines[i].strip() == fence:
                    i += 1
                    break
                i += 1
            current_content.extend(code_lines)
            continue

        current_content.append(line)
        i += 1

    flush()
    return chunks


def main() -> int:
    db_path = "/tmp/doltlite-python-repro.db"
    for suffix in ("", "-wal", "-shm"):
        try:
            os.unlink(db_path + suffix)
        except FileNotFoundError:
            pass

    con = sqlite3.connect(db_path)
    try:
        con.executescript(
            """
            CREATE VIRTUAL TABLE chunks USING fts5(
              title,
              content,
              source_id UNINDEXED,
              content_type UNINDEXED,
              tokenize='porter unicode61'
            );
            """
        )

        for file_index, rel in enumerate(INPUTS, start=1):
            text = (ROOT / rel).read_text(encoding="utf-8")
            chunks = chunk_markdown(text)
            print(f"FILE {rel} chunks {len(chunks)}")
            for chunk_index, chunk in enumerate(chunks, start=1):
                rowid = file_index * 1_000_000 + chunk_index
                content_type = "code" if chunk["has_code"] else "prose"
                try:
                    con.execute(
                        """
                        INSERT INTO chunks (rowid, title, content, source_id, content_type)
                        VALUES (?, ?, ?, ?, ?)
                        """,
                        (
                            rowid,
                            chunk["title"],
                            chunk["content"],
                            file_index,
                            content_type,
                        ),
                    )
                    print(f"  ok {chunk_index} {len(str(chunk['content']).encode('utf-8'))}")
                except Exception as exc:
                    print(f"  fail {chunk_index} {exc}")
                    return 1

        total = con.execute("SELECT count(*) FROM chunks").fetchone()[0]
        print(f"PASS rows={total}")
        return 0
    finally:
        con.close()


if __name__ == "__main__":
    raise SystemExit(main())
