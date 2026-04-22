import { type GcSidebarLayoutResult, groupThreadsByRigAndAgent } from "@t3tools/contracts";
import { Effect } from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http";

import { ServerAuth } from "../auth/Services/ServerAuth.ts";
import { ProjectionSnapshotQuery } from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import { GcApiClient } from "./Services/GcApiClient.ts";

function isLoopbackAddress(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  if (normalized === "127.0.0.1" || normalized === "::1" || normalized === "::ffff:127.0.0.1") {
    return true;
  }
  if (normalized.startsWith("127.")) {
    return true;
  }
  const host = normalized.startsWith("::ffff:") ? normalized.slice("::ffff:".length) : normalized;
  return (
    host === "127.0.0.1" || host === "::1" || host === "::ffff:127.0.0.1" || host.startsWith("127.")
  );
}

const authenticateOwnerSession = Effect.gen(function* () {
  const request = yield* HttpServerRequest.HttpServerRequest;
  if (request.remoteAddress && isLoopbackAddress(request.remoteAddress.value)) {
    return {
      sessionId: "local-gc-sidebar-layout",
      subject: "local-gc-sidebar-layout",
      method: "bearer-session-token",
      role: "owner",
    } as const;
  }
  const serverAuth = yield* ServerAuth;
  const session = yield* serverAuth.authenticateHttpRequest(request);
  if (session.role !== "owner") {
    return yield* Effect.fail(new Error("Only owner sessions can inspect GC sidebar layout."));
  }
  return session;
});

export const gcSidebarLayoutRouteLayer = HttpRouter.add(
  "GET",
  "/api/gc/sidebar-layout",
  Effect.gen(function* () {
    yield* authenticateOwnerSession;

    const gcApi = yield* GcApiClient;
    const projectionSnapshotQuery = yield* ProjectionSnapshotQuery;

    const config = yield* gcApi.getConfig();
    if (!config) {
      return yield* Effect.fail(new Error("GC config unavailable."));
    }

    const shellSnapshot = yield* projectionSnapshotQuery.getShellSnapshot();
    const activeThreads = shellSnapshot.threads.filter((thread) => thread.archivedAt === null);
    const { rigGroups, standaloneThreads } = groupThreadsByRigAndAgent(activeThreads, { config });

    return HttpServerResponse.jsonUnsafe(
      {
        config,
        rigGroups,
        standaloneThreads,
      } satisfies GcSidebarLayoutResult,
      { status: 200 },
    );
  }).pipe(
    Effect.catch((error) =>
      Effect.succeed(
        HttpServerResponse.jsonUnsafe(
          {
            error: error instanceof Error ? error.message : "Failed to build GC sidebar layout.",
          },
          { status: 500 },
        ),
      ),
    ),
  ),
);
