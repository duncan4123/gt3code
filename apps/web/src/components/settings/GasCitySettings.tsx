import { InfoIcon, RefreshCwIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import type { GcConfigResult, ServerProcessSignal } from "@t3tools/contracts";

import { ensureLocalApi } from "../../localApi";
import { useProcessDiagnostics } from "../../lib/processDiagnosticsState";
import { cn } from "../../lib/utils";
import { useServerConfig } from "../../rpc/serverState";
import { Button } from "../ui/button";
import { ScrollArea } from "../ui/scroll-area";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { ProcessDiagnosticsTable } from "./DiagnosticsSettings";
import { SettingsPageContainer, SettingsSection } from "./settingsLayout";

function DiagnosticsRefreshButton({ onClick }: { onClick: () => void }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            size="icon-xs"
            variant="ghost"
            className="size-5 rounded-sm p-0 text-muted-foreground hover:text-foreground"
            onClick={onClick}
            aria-label="Refresh Gas City diagnostics"
          >
            <RefreshCwIcon className="size-3" />
          </Button>
        }
      />
      <TooltipPopup side="top">Refresh Gas City diagnostics</TooltipPopup>
    </Tooltip>
  );
}

function StatBlock({
  label,
  value,
  tooltip,
  tone = "default",
}: {
  label: string;
  value: string;
  tooltip?: ReactNode;
  tone?: "default" | "warning" | "danger";
}) {
  return (
    <div className="min-w-0 border-border/60 px-4 py-3 sm:px-5">
      <div className="flex min-w-0 items-center gap-1.5 text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground/70">
        <span className="min-w-0 truncate">{label}</span>
        {tooltip ? (
          <Tooltip>
            <TooltipTrigger
              render={
                <button
                  type="button"
                  className="inline-flex size-3.5 shrink-0 items-center justify-center rounded-sm text-muted-foreground/60 hover:text-foreground"
                  aria-label={`${label} details`}
                >
                  <InfoIcon className="size-3" />
                </button>
              }
            />
            <TooltipPopup
              side="top"
              className="max-w-[min(300px,calc(100vw-2rem))] whitespace-normal text-left text-[11px] leading-relaxed text-wrap"
            >
              {tooltip}
            </TooltipPopup>
          </Tooltip>
        ) : null}
      </div>
      <div
        className={cn(
          "mt-1 truncate font-mono text-lg font-semibold tabular-nums text-foreground",
          tone === "warning" && "text-amber-600 dark:text-amber-400",
          tone === "danger" && "text-destructive",
        )}
      >
        {value}
      </div>
    </div>
  );
}

function StatsGrid({ children }: { children: ReactNode }) {
  return (
    <div className="relative grid grid-cols-2 sm:grid-cols-4">
      <span
        className="pointer-events-none absolute inset-y-0 left-1/2 w-px bg-border/60"
        aria-hidden
      />
      <span
        className="pointer-events-none absolute inset-x-0 top-1/2 h-px bg-border/60 sm:hidden"
        aria-hidden
      />
      <span
        className="pointer-events-none absolute inset-y-0 left-1/4 hidden w-px bg-border/60 sm:block"
        aria-hidden
      />
      <span
        className="pointer-events-none absolute inset-y-0 left-3/4 hidden w-px bg-border/60 sm:block"
        aria-hidden
      />
      {children}
    </div>
  );
}

function DiagnosticsTable({ children }: { children: ReactNode }) {
  return (
    <ScrollArea
      chainVerticalScroll
      scrollFade
      hideScrollbars
      className="w-full max-w-full rounded-none"
    >
      <table className="w-full min-w-[640px] table-fixed text-left text-xs">
        <colgroup>
          <col className="w-[180px]" />
          <col />
        </colgroup>
        <tbody className="divide-y divide-border/60">{children}</tbody>
      </table>
    </ScrollArea>
  );
}

function ValueRow({ label, value }: { label: string; value: string | number | undefined }) {
  return (
    <tr>
      <td className="whitespace-nowrap px-4 py-3 align-top text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground/70 first:sm:pl-5">
        {label}
      </td>
      <td className="break-all px-4 py-3 align-top font-mono text-xs text-foreground last:sm:pr-5">
        {value ?? <span className="font-sans text-muted-foreground">not set</span>}
      </td>
    </tr>
  );
}

function boolValue(value: boolean | undefined) {
  if (value === undefined) {
    return undefined;
  }
  return value ? "yes" : "no";
}

type GasCityLifecycleRow = {
  readonly name: string;
  readonly status: string;
  readonly endpoint: string;
  readonly path: string;
  readonly type: string;
  readonly details?: string | undefined;
};

function GasCityLifecycleTable({
  rows,
  emptyLabel,
}: {
  rows: readonly GasCityLifecycleRow[];
  emptyLabel: string;
}) {
  return (
    <ScrollArea
      chainVerticalScroll
      scrollFade
      hideScrollbars
      className="max-h-[min(64vh,44rem)] w-full max-w-full rounded-none border-t border-border/60"
    >
      <table className="w-full min-w-[1120px] table-fixed text-left text-xs">
        <colgroup>
          <col className="w-[16%]" />
          <col className="w-[12%]" />
          <col className="w-[16%]" />
          <col className="w-[26%]" />
          <col className="w-[12%]" />
          <col className="w-[18%]" />
        </colgroup>
        <thead className="sticky top-0 z-10 border-b border-border/60 bg-card text-[11px] uppercase tracking-[0.08em] text-muted-foreground/70">
          <tr>
            <th className="px-4 py-2 font-semibold sm:pl-5">Name</th>
            <th className="px-3 py-2 font-semibold">Status</th>
            <th className="px-3 py-2 font-semibold">Endpoint</th>
            <th className="px-3 py-2 font-semibold">Path</th>
            <th className="px-3 py-2 font-semibold">Type</th>
            <th className="px-3 py-2 font-semibold sm:pr-5">Details</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border/50">
          {rows.length === 0 ? (
            <tr>
              <td colSpan={6} className="px-4 py-4 text-xs text-muted-foreground sm:px-5">
                {emptyLabel}
              </td>
            </tr>
          ) : null}
          {rows.map((row) => (
            <tr key={`${row.type}:${row.name}`} className="hover:bg-muted/20">
              <td className="px-4 py-2 align-middle font-medium text-foreground sm:pl-5">
                {row.name}
              </td>
              <td className="px-3 py-2 align-middle">{row.status}</td>
              <td className="truncate px-3 py-2 align-middle font-mono text-muted-foreground">
                {row.endpoint}
              </td>
              <td className="px-3 py-2 align-middle text-muted-foreground">
                <Tooltip>
                  <TooltipTrigger render={<span className="block truncate">{row.path}</span>} />
                  <TooltipPopup
                    side="top"
                    className="max-w-[min(520px,calc(100vw-2rem))] break-all font-mono text-[11px]"
                  >
                    {row.path}
                  </TooltipPopup>
                </Tooltip>
              </td>
              <td className="truncate px-3 py-2 align-middle text-muted-foreground">{row.type}</td>
              <td className="px-3 py-2 align-middle text-muted-foreground sm:pr-5">
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <span
                        className={cn(
                          "block truncate",
                          row.details?.startsWith("Issue:") ? "text-destructive" : undefined,
                        )}
                      >
                        {row.details ?? "none"}
                      </span>
                    }
                  />
                  <TooltipPopup
                    side="top"
                    className="max-w-[min(760px,calc(100vw-2rem))] whitespace-pre-line break-words font-mono text-[11px]"
                  >
                    {row.details ?? "none"}
                  </TooltipPopup>
                </Tooltip>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </ScrollArea>
  );
}

export function GasCitySettingsPanel() {
  const serverConfig = useServerConfig();
  const diagnostics = serverConfig?.gascity;
  const {
    data: processData,
    isPending: isProcessPending,
    refresh: refreshProcessDiagnostics,
  } = useProcessDiagnostics();
  const [gcConfig, setGcConfig] = useState<GcConfigResult | null>(null);
  const [gcConfigError, setGcConfigError] = useState<string | null>(null);
  const [isRefreshingGcConfig, setIsRefreshingGcConfig] = useState(false);
  const [signalingPid, setSignalingPid] = useState<number | null>(null);
  const supervisorState =
    diagnostics?.supervisorTomlExists && diagnostics.supervisorPort ? "configured" : "missing";
  const t3BridgeState =
    diagnostics?.t3WsReachable === true
      ? "reachable"
      : diagnostics?.t3WsReachable === false
        ? "unreachable"
        : "unknown";
  const doltliteState = diagnostics?.beadStores.some(
    (store) => store.backend === "doltlite" || store.database === "doltlite",
  )
    ? "doltlite"
    : "unknown";
  const t3WsRouteState =
    diagnostics?.t3WsLooksLikeTailscale === true
      ? "tailscale"
      : diagnostics?.t3WsIsLoopback === true
        ? "loopback"
        : diagnostics?.t3WsHost
          ? "remote"
          : "unknown";
  const cityRoots = useMemo(
    () =>
      (gcConfig?.rigs ?? []).filter(
        (rig) => rig.path.endsWith("/city.toml") === false && rig.lifecycle,
      ),
    [gcConfig],
  );
  const lifecycleRows = useMemo<GasCityLifecycleRow[]>(() => {
    const supervisorRunning = Boolean(gcConfig?.lifecycle?.supervisorRunning);
    return [
      {
        name: "supervisor",
        status:
          gcConfig?.lifecycle?.supervisorStatus ?? (supervisorRunning ? "Running" : "Stopped"),
        endpoint: diagnostics?.resolvedApiUrl ?? "not set",
        path: diagnostics?.runtimeHome ?? "not set",
        type: "shared supervisor",
        details:
          [
            typeof gcConfig?.lifecycle?.supervisorPid === "number"
              ? `PID ${gcConfig.lifecycle.supervisorPid}`
              : undefined,
            gcConfig?.lifecycle?.authority
              ? `Authority: ${gcConfig.lifecycle.authority}`
              : undefined,
            gcConfig?.lifecycle?.issue ? `Issue: ${gcConfig.lifecycle.issue}` : undefined,
            gcConfig?.lifecycle?.nextAction ? `Next: ${gcConfig.lifecycle.nextAction}` : undefined,
          ]
            .filter(Boolean)
            .join("\n") || undefined,
      },
      ...cityRoots.map((city) => {
        const controllerRunning = Boolean(city.lifecycle?.controllerRunning);
        return {
          name: city.name,
          status: city.lifecycle?.controllerStatus ?? (controllerRunning ? "Running" : "Stopped"),
          endpoint:
            typeof city.lifecycle?.supervisorPort === "number"
              ? `:${city.lifecycle.supervisorPort}`
              : (city.lifecycle?.supervisorUrl ?? diagnostics?.resolvedApiUrl ?? "not set"),
          path: city.path,
          type: "city controller",
          details:
            [
              city.lifecycle?.controllerDetail,
              typeof city.lifecycle?.controllerPid === "number"
                ? `PID ${city.lifecycle.controllerPid}`
                : undefined,
              city.lifecycle?.authority ? `Authority: ${city.lifecycle.authority}` : undefined,
              city.lifecycle?.issue ? `Issue: ${city.lifecycle.issue}` : undefined,
              city.lifecycle?.nextAction ? `Next: ${city.lifecycle.nextAction}` : undefined,
            ]
              .filter(Boolean)
              .join("\n") || undefined,
        };
      }),
    ];
  }, [cityRoots, diagnostics?.resolvedApiUrl, diagnostics?.runtimeHome, gcConfig?.lifecycle]);
  const refreshGcConfig = useCallback(() => {
    setIsRefreshingGcConfig(true);
    setGcConfigError(null);
    void ensureLocalApi()
      .gc.getConfig({})
      .then(setGcConfig)
      .catch((error: unknown) => {
        setGcConfig(null);
        setGcConfigError(
          error instanceof Error ? error.message : "Failed to load Gas City config.",
        );
      })
      .finally(() => setIsRefreshingGcConfig(false));
  }, []);
  const signalProcess = useCallback(
    (pid: number, signal: ServerProcessSignal) => {
      if (
        signal === "SIGKILL" &&
        !window.confirm(`Send SIGKILL to process ${pid}? This cannot be handled by the process.`)
      ) {
        return;
      }
      setSignalingPid(pid);
      void ensureLocalApi()
        .server.signalProcess({ pid, signal })
        .finally(() => {
          setSignalingPid(null);
          refreshProcessDiagnostics();
        });
    },
    [refreshProcessDiagnostics],
  );

  useEffect(() => {
    refreshGcConfig();
  }, [refreshGcConfig]);

  return (
    <SettingsPageContainer className="max-w-7xl">
      <SettingsSection
        title="Gas City API"
        headerAction={<DiagnosticsRefreshButton onClick={() => window.location.reload()} />}
      >
        <StatsGrid>
          <StatBlock label="API URL" value={diagnostics?.resolvedApiUrl ?? "..."} />
          <StatBlock label="Source" value={diagnostics?.apiUrlSource ?? "..."} />
          <StatBlock
            label="Supervisor"
            value={supervisorState}
            tone={supervisorState === "missing" ? "warning" : "default"}
          />
          <StatBlock
            label="Port"
            value={diagnostics?.supervisorPort ? String(diagnostics.supervisorPort) : "..."}
            tooltip="Read from the bundled Gas City supervisor.toml in the T3 runtime home."
          />
          <StatBlock
            label="T3Bridge"
            value={t3BridgeState}
            tone={t3BridgeState === "unreachable" ? "danger" : "default"}
            tooltip="Checks the WebSocket URL Gas City uses for T3Bridge sessions."
          />
          <StatBlock
            label="Route"
            value={t3WsRouteState}
            tone={t3WsRouteState === "tailscale" ? "warning" : "default"}
            tooltip="Classifies the T3Bridge WebSocket host as loopback, Tailscale, or another remote host."
          />
          <StatBlock
            label="Beads"
            value={doltliteState}
            tone={doltliteState === "unknown" ? "warning" : "default"}
            tooltip="Reads .beads/metadata.json for the tracked T3/Gas City stores."
          />
        </StatsGrid>
        <DiagnosticsTable>
          <ValueRow label="GC_API_URL" value={diagnostics?.configuredApiUrl} />
          <ValueRow
            label="Supervisor TOML"
            value={
              diagnostics
                ? `${diagnostics.supervisorTomlPath} (${diagnostics.supervisorTomlExists ? "exists" : "missing"})`
                : undefined
            }
          />
          <ValueRow
            label="Tailscale serve"
            value={
              diagnostics
                ? `${diagnostics.tailscaleServeEnabled ? "enabled" : "disabled"} on ${diagnostics.tailscaleServePort}`
                : undefined
            }
          />
        </DiagnosticsTable>
      </SettingsSection>

      <SettingsSection title="Registered Cities">
        {gcConfigError ? (
          <div className="px-4 py-3 text-xs text-destructive sm:px-5">{gcConfigError}</div>
        ) : null}
        <GasCityLifecycleTable
          rows={lifecycleRows}
          emptyLabel={
            isRefreshingGcConfig ? "Loading Gas City lifecycle..." : "No registered cities found."
          }
        />
      </SettingsSection>

      <SettingsSection title="T3 Descendant Processes">
        <ProcessDiagnosticsTable
          processes={processData?.processes ?? []}
          signalingPid={signalingPid}
          onSignal={signalProcess}
          emptyLabel={
            isProcessPending ? "Loading live processes..." : "No live descendant processes found."
          }
        />
      </SettingsSection>

      <SettingsSection title="Gas City System Processes">
        {diagnostics?.processScanError ? (
          <div className="px-4 py-3 text-xs text-destructive sm:px-5">
            {diagnostics.processScanError}
          </div>
        ) : null}
        <ProcessDiagnosticsTable
          processes={diagnostics?.processes ?? []}
          signalingPid={signalingPid}
          onSignal={signalProcess}
          emptyLabel="No live Gas City, bd, DoltLite, or Dolt processes found."
        />
      </SettingsSection>

      <SettingsSection title="Runtime">
        <DiagnosticsTable>
          <ValueRow label="App cwd" value={diagnostics?.cwd} />
          <ValueRow label="App branch" value={diagnostics?.appBranch} />
          <ValueRow label="Runtime home" value={diagnostics?.runtimeHome} />
          <ValueRow label="City path" value={diagnostics?.cityPath} />
          <ValueRow label="City name" value={diagnostics?.cityName} />
          <ValueRow label="Worktrees" value={diagnostics?.worktreesDir} />
          <ValueRow label="T3 home" value={diagnostics?.t3Home} />
          <ValueRow label="T3 WS URL" value={diagnostics?.t3WsUrl} />
          <ValueRow label="T3 WS source" value={diagnostics?.t3WsUrlSource} />
          <ValueRow label="T3 WS host" value={diagnostics?.t3WsHost} />
          <ValueRow label="T3 WS loopback" value={boolValue(diagnostics?.t3WsIsLoopback)} />
          <ValueRow
            label="T3 WS Tailscale-like"
            value={boolValue(diagnostics?.t3WsLooksLikeTailscale)}
          />
          <ValueRow
            label="T3 WS reachable"
            value={
              diagnostics?.t3WsReachable === undefined
                ? undefined
                : diagnostics.t3WsReachable
                  ? "yes"
                  : `no${diagnostics.t3WsReachabilityError ? `: ${diagnostics.t3WsReachabilityError}` : ""}`
            }
          />
          <ValueRow
            label="T3 server port"
            value={
              diagnostics?.t3ServerPort
                ? `${diagnostics.t3ServerPort}${
                    diagnostics.t3ServerPortListening === false ? " (not listening)" : ""
                  }`
                : undefined
            }
          />
          <ValueRow
            label="Projection sidecar"
            value={
              diagnostics
                ? `${diagnostics.projectionDbPath} (${diagnostics.projectionDbExists ? "exists" : "missing"})`
                : undefined
            }
          />
        </DiagnosticsTable>
      </SettingsSection>

      <SettingsSection title="DoltLite Beads">
        <DiagnosticsTable>
          <ValueRow label="GC native beads" value={diagnostics?.nativeDoltliteBeads} />
          <ValueRow label="Beads backend" value={diagnostics?.beadsBackend} />
          <ValueRow label="DoltLite library" value={diagnostics?.doltliteLibrary} />
          <ValueRow label="LD_LIBRARY_PATH" value={diagnostics?.ldLibraryPath} />
          {diagnostics?.beadStores.map((store) => (
            <ValueRow
              key={`${store.label}:${store.path}`}
              label={store.label}
              value={[
                store.path,
                store.exists ? "exists" : "missing",
                store.backend ? `backend=${store.backend}` : undefined,
                store.mode ? `mode=${store.mode}` : undefined,
                store.database ? `database=${store.database}` : undefined,
                store.doltDatabase ? `dolt_database=${store.doltDatabase}` : undefined,
                store.error ? `error=${store.error}` : undefined,
              ]
                .filter(Boolean)
                .join(" | ")}
            />
          ))}
        </DiagnosticsTable>
      </SettingsSection>

      <SettingsSection title="Binaries">
        <DiagnosticsTable>
          <ValueRow label="gc" value={diagnostics?.gcBin} />
          <ValueRow label="bd" value={diagnostics?.bdBin} />
          <ValueRow label="br" value={diagnostics?.brBin} />
        </DiagnosticsTable>
      </SettingsSection>
    </SettingsPageContainer>
  );
}
