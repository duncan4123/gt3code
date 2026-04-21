#!/usr/bin/env node

const DEFAULT_HTTP_URL = "http://127.0.0.1:3773";

function trim(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function agentLabel(agentQualified) {
  const slash = agentQualified.lastIndexOf("/");
  const scoped = slash >= 0 ? agentQualified.slice(slash + 1) : agentQualified;
  const dot = scoped.lastIndexOf(".");
  return dot >= 0 ? scoped.slice(dot + 1) : scoped;
}

function deriveCanonicalFolderMetadata(meta) {
  const agent = trim(meta["gc.agent"]);
  if (!agent) {
    return null;
  }
  const rig = trim(meta["gc.rig"]);
  const city = trim(meta["gc.city"]) ?? "gc";
  return {
    "gc.groupKind": rig ? "rig" : "workspace",
    "gc.groupId": rig ?? city,
    "gc.groupLabel": rig ?? city.toUpperCase(),
    "gc.agentQualified": agent,
    "gc.agentLabel": agentLabel(agent),
  };
}

function needsBackfill(meta) {
  return (
    !trim(meta["gc.groupKind"]) ||
    !trim(meta["gc.groupId"]) ||
    !trim(meta["gc.groupLabel"]) ||
    !trim(meta["gc.agentQualified"]) ||
    !trim(meta["gc.agentLabel"])
  );
}

async function issueBridgeWsToken(baseUrl) {
  const response = await fetch(`${baseUrl}/api/auth/bridge-ws-token`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
  if (!response.ok) {
    throw new Error(`bridge ws token failed: ${response.status} ${await response.text()}`);
  }
  const payload = await response.json();
  if (!payload?.token) {
    throw new Error("bridge ws token response missing token");
  }
  return payload.token;
}

async function rpcCall(wsUrl, tag, payload) {
  const ws = new WebSocket(wsUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve, { once: true });
    ws.addEventListener("error", reject, { once: true });
  });

  const result = await new Promise((resolve, reject) => {
    ws.addEventListener(
      "message",
      (event) => {
        try {
          const msg = JSON.parse(String(event.data));
          if (msg?._tag !== "Response") {
            return;
          }
          if (msg?.exit?._tag === "Failure") {
            reject(new Error(`rpc ${tag} failed: ${JSON.stringify(msg.exit.cause)}`));
            return;
          }
          resolve(msg.exit?.value ?? {});
        } catch (error) {
          reject(error);
        } finally {
          ws.close();
        }
      },
      { once: true },
    );
    ws.send(
      JSON.stringify({
        _tag: "Request",
        id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        tag,
        payload: payload ?? {},
        headers: [],
      }),
    );
  });

  return result;
}

async function main() {
  const baseUrl = process.env.T3_BASE_URL ?? DEFAULT_HTTP_URL;
  const token = await issueBridgeWsToken(baseUrl);
  const wsUrl = new URL(baseUrl.replace(/^http/, "ws") + "/ws");
  wsUrl.searchParams.set("wsToken", token);

  const snapshot = await rpcCall(wsUrl.toString(), "orchestration.getSnapshot", {});
  const threads = Array.isArray(snapshot?.result?.threads) ? snapshot.result.threads : [];

  let updated = 0;
  let skipped = 0;
  for (const thread of threads) {
    const threadId = trim(thread?.id);
    const customMetadata =
      thread && typeof thread.customMetadata === "object" && thread.customMetadata
        ? { ...thread.customMetadata }
        : {};
    if (!threadId || !trim(customMetadata["gc.agent"])) {
      skipped += 1;
      continue;
    }
    if (!needsBackfill(customMetadata)) {
      skipped += 1;
      continue;
    }
    const patch = deriveCanonicalFolderMetadata(customMetadata);
    if (!patch) {
      skipped += 1;
      continue;
    }
    await rpcCall(wsUrl.toString(), "orchestration.dispatchCommand", {
      type: "thread.meta.update",
      commandId: `gc-folder-backfill-${threadId}`,
      threadId,
      customMetadata: {
        ...customMetadata,
        ...patch,
      },
    });
    updated += 1;
    process.stdout.write(`updated ${threadId} ${patch["gc.groupKind"]} ${patch["gc.groupId"]}\n`);
  }

  process.stdout.write(`done updated=${updated} skipped=${skipped}\n`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
