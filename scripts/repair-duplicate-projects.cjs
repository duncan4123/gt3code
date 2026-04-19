#!/usr/bin/env node

const crypto = require("node:crypto");
const path = require("node:path");

const Database = require("/data/projects/t3code/node_modules/.bun/better-sqlite3@12.8.0/node_modules/better-sqlite3");

function normalizeWorkspaceRoot(workspaceRoot) {
  return workspaceRoot.trim().replace(/\/+$/, "");
}

function readDuplicateGroups(db) {
  const rows = db
    .prepare(
      `
        SELECT
          project_id AS projectId,
          title,
          workspace_root AS workspaceRoot,
          created_at AS createdAt,
          updated_at AS updatedAt,
          deleted_at AS deletedAt
        FROM projection_projects
        WHERE deleted_at IS NULL
        ORDER BY workspace_root ASC, created_at ASC, project_id ASC
      `,
    )
    .all();

  const grouped = new Map();
  for (const row of rows) {
    const workspaceRoot = normalizeWorkspaceRoot(row.workspaceRoot);
    const group = grouped.get(workspaceRoot) ?? [];
    group.push({ ...row, workspaceRoot });
    grouped.set(workspaceRoot, group);
  }

  return [...grouped.entries()]
    .filter(([, group]) => group.length > 1)
    .map(([workspaceRoot, group]) => {
      const canonicalProject = group[0];
      const duplicateProjects = group.slice(1);
      return {
        workspaceRoot,
        canonicalProject,
        duplicateProjects,
      };
    });
}

function readThreadCountsByProjectId(db, projectIds) {
  if (projectIds.length === 0) {
    return new Map();
  }
  const placeholders = projectIds.map(() => "?").join(", ");
  const rows = db
    .prepare(
      `
        SELECT
          project_id AS projectId,
          COUNT(*) AS threadCount
        FROM projection_threads
        WHERE deleted_at IS NULL
          AND project_id IN (${placeholders})
        GROUP BY project_id
      `,
    )
    .all(...projectIds);
  return new Map(rows.map((row) => [row.projectId, row.threadCount]));
}

function readDuplicateSummary(db) {
  const groups = readDuplicateGroups(db);
  const threadCounts = readThreadCountsByProjectId(
    db,
    groups.flatMap((group) => group.duplicateProjects.map((project) => project.projectId)),
  );

  return groups.map((group) => ({
    workspaceRoot: group.workspaceRoot,
    canonicalProjectId: group.canonicalProject.projectId,
    duplicateProjects: group.duplicateProjects.map((project) => ({
      projectId: project.projectId,
      createdAt: project.createdAt,
      threadCount: threadCounts.get(project.projectId) ?? 0,
    })),
  }));
}

function updateThreadCreatedEvents(db, duplicateProjectId, canonicalProjectId) {
  const rows = db
    .prepare(
      `
        SELECT
          sequence,
          payload_json AS payloadJson
        FROM orchestration_events
        WHERE event_type = 'thread.created'
          AND json_extract(payload_json, '$.projectId') = ?
        ORDER BY sequence ASC
      `,
    )
    .all(duplicateProjectId);

  const updateStatement = db.prepare(
    `
      UPDATE orchestration_events
      SET payload_json = ?
      WHERE sequence = ?
    `,
  );

  for (const row of rows) {
    const payload = JSON.parse(row.payloadJson);
    payload.projectId = canonicalProjectId;
    updateStatement.run(JSON.stringify(payload), row.sequence);
  }

  return rows.length;
}

function appendProjectDeletedEvent(db, projectId, deletedAt) {
  const streamVersionRow = db
    .prepare(
      `
        SELECT COALESCE(MAX(stream_version), -1) AS maxStreamVersion
        FROM orchestration_events
        WHERE aggregate_kind = 'project'
          AND stream_id = ?
      `,
    )
    .get(projectId);

  db.prepare(
    `
      INSERT INTO orchestration_events (
        event_id,
        aggregate_kind,
        stream_id,
        stream_version,
        event_type,
        occurred_at,
        command_id,
        causation_event_id,
        correlation_id,
        actor_kind,
        payload_json,
        metadata_json
      )
      VALUES (?, 'project', ?, ?, 'project.deleted', ?, NULL, NULL, NULL, 'server', ?, '{}')
    `,
  ).run(
    crypto.randomUUID(),
    projectId,
    Number(streamVersionRow?.maxStreamVersion ?? -1) + 1,
    deletedAt,
    JSON.stringify({
      projectId,
      deletedAt,
    }),
  );
}

function repairDuplicates(db) {
  const groups = readDuplicateGroups(db);
  if (groups.length === 0) {
    return { repaired: [], totalThreadRewrites: 0 };
  }

  const moveThreadsStatement = db.prepare(
    `
      UPDATE projection_threads
      SET project_id = ?
      WHERE project_id = ?
    `,
  );
  const markProjectDeletedStatement = db.prepare(
    `
      UPDATE projection_projects
      SET deleted_at = ?, updated_at = ?
      WHERE project_id = ?
    `,
  );

  const repaired = [];
  let totalThreadRewrites = 0;

  for (const group of groups) {
    const deletedAt = new Date().toISOString();
    const projectIds = group.duplicateProjects.map((project) => project.projectId);
    const threadCounts = readThreadCountsByProjectId(db, projectIds);

    const repairedProjects = [];
    for (const duplicateProject of group.duplicateProjects) {
      const movedProjectionThreads = moveThreadsStatement.run(
        group.canonicalProject.projectId,
        duplicateProject.projectId,
      ).changes;
      const rewrittenThreadCreatedEvents = updateThreadCreatedEvents(
        db,
        duplicateProject.projectId,
        group.canonicalProject.projectId,
      );
      appendProjectDeletedEvent(db, duplicateProject.projectId, deletedAt);
      markProjectDeletedStatement.run(deletedAt, deletedAt, duplicateProject.projectId);

      totalThreadRewrites += rewrittenThreadCreatedEvents;
      repairedProjects.push({
        projectId: duplicateProject.projectId,
        activeThreadCount: threadCounts.get(duplicateProject.projectId) ?? 0,
        movedProjectionThreads,
        rewrittenThreadCreatedEvents,
      });
    }

    repaired.push({
      workspaceRoot: group.workspaceRoot,
      canonicalProjectId: group.canonicalProject.projectId,
      repairedProjects,
    });
  }

  return { repaired, totalThreadRewrites };
}

function validate(db) {
  const orphanedThreadCount = db
    .prepare(
      `
        SELECT COUNT(*) AS count
        FROM projection_threads AS threads
        LEFT JOIN projection_projects AS projects
          ON projects.project_id = threads.project_id
        WHERE projects.project_id IS NULL
      `,
    )
    .get().count;

  const activeThreadsAttachedToDeletedProjects = db
    .prepare(
      `
        SELECT COUNT(*) AS count
        FROM projection_threads AS threads
        INNER JOIN projection_projects AS projects
          ON projects.project_id = threads.project_id
        WHERE threads.deleted_at IS NULL
          AND projects.deleted_at IS NOT NULL
      `,
    )
    .get().count;

  const remainingDuplicateRoots = db
    .prepare(
      `
        SELECT workspace_root AS workspaceRoot, COUNT(*) AS activeProjectCount
        FROM projection_projects
        WHERE deleted_at IS NULL
        GROUP BY workspace_root
        HAVING COUNT(*) > 1
        ORDER BY workspace_root ASC
      `,
    )
    .all();

  return {
    orphanedThreadCount,
    activeThreadsAttachedToDeletedProjects,
    remainingDuplicateRoots,
  };
}

function main() {
  const dbPath = process.argv[2] ?? path.join("/home/ubuntu/.t3/dev", "state-proj.sqlite");
  const db = new Database(dbPath);

  const before = readDuplicateSummary(db);
  if (before.length === 0) {
    console.log(
      JSON.stringify(
        {
          dbPath,
          repaired: false,
          duplicateGroups: [],
        },
        null,
        2,
      ),
    );
    db.close();
    return;
  }

  const transaction = db.transaction(() => {
    const repairResult = repairDuplicates(db);
    const validation = validate(db);
    if (
      validation.orphanedThreadCount !== 0 ||
      validation.activeThreadsAttachedToDeletedProjects !== 0 ||
      validation.remainingDuplicateRoots.length > 0
    ) {
      throw new Error(`Validation failed: ${JSON.stringify(validation)}`);
    }
    return {
      repairResult,
      validation,
    };
  });

  const { repairResult, validation } = transaction();
  db.close();

  console.log(
    JSON.stringify(
      {
        dbPath,
        repaired: true,
        before,
        ...repairResult,
        validation,
      },
      null,
      2,
    ),
  );
}

main();
