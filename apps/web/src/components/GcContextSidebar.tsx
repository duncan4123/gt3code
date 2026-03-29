import { memo, useMemo } from "react";
import type { GcThreadContextResult } from "@t3tools/contracts";
import { WrenchIcon } from "lucide-react";
import { Badge } from "./ui/badge";
import { ScrollArea } from "./ui/scroll-area";
import { inferRigFromBeadId, type GcTimelineEvent } from "../session-logic";

interface GcContextSidebarProps {
  metadata: Record<string, string>;
  onSelectWorkedBead?: (sourceEventId: string) => void;
  workedBeads?: ReadonlyArray<{
    id: string;
    beadId: string;
    beadTitle?: string;
    beadStatus?: string;
    formula?: string;
    moleculeId?: string;
    rig?: string;
    createdAt: string;
    sourceEventId: string;
    sourceKind: string;
  }>;
  threadContext?: GcThreadContextResult | null;
  gcEvents?: ReadonlyArray<GcTimelineEvent>;
}

function contextValue(value: string | undefined, fallback = "—") {
  return value && value.trim() ? value : fallback;
}

function ContextRow({ label, value }: { label: string; value: string | undefined }) {
  return (
    <div className="space-y-1">
      <div className="text-[10px] font-semibold tracking-widest text-muted-foreground/45 uppercase">
        {label}
      </div>
      <div className="break-words text-[13px] leading-snug text-foreground/85">
        {contextValue(value)}
      </div>
    </div>
  );
}

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[10px] font-semibold tracking-widest text-muted-foreground/40 uppercase">
      {children}
    </div>
  );
}

const GcContextSidebar = memo(function GcContextSidebar({
  metadata,
  onSelectWorkedBead,
  workedBeads = [],
  threadContext,
  gcEvents = [],
}: GcContextSidebarProps) {
  const convoyClosedCount = metadata["gc.convoyClosedCount"];
  const convoyTotalCount = metadata["gc.convoyTotalCount"];
  const convoyProgress =
    convoyClosedCount && convoyTotalCount ? `${convoyClosedCount}/${convoyTotalCount}` : undefined;
  const currentBeadId = metadata["gc.bead"];
  const currentBead = workedBeads.find((bead) => bead.beadId === currentBeadId);
  const completedWorkedBeads = workedBeads.filter((bead) => bead.beadStatus === "closed");
  const workflowFormula = metadata["gc.formula"] ?? currentBead?.formula;
  const workflowMolecule = metadata["gc.molecule"] ?? currentBead?.moleculeId;
  const latestWorkedBead = workedBeads[0];
  const threadRig =
    metadata["gc.rig"] ?? (currentBeadId ? inferRigFromBeadId(currentBeadId) : undefined);

  // Enriched data from gc.getThreadContext
  const formula = threadContext?.formula ?? null;
  const apiBead = threadContext?.bead ?? null;
  const beadDescription = apiBead?.description ?? metadata["gc.beadDescription"] ?? null;
  const beadStatus = apiBead?.status ?? metadata["gc.beadStatus"];
  const beadPriority =
    apiBead?.priority != null ? String(apiBead.priority) : metadata["gc.beadPriority"];
  const beadAssignee = apiBead?.assignee ?? metadata["gc.beadAssignee"];
  const beadType = metadata["gc.beadType"];
  const beadLabels = metadata["gc.beadLabels"];
  const convoy = threadContext?.convoy ?? null;
  const session = threadContext?.session ?? null;

  // Prefer API convoy data over metadata when available
  const effectiveConvoyProgress = convoy
    ? `${convoy.closedCount}/${convoy.totalCount}`
    : convoyProgress;
  const effectiveConvoyStatus = convoy?.status ?? metadata["gc.convoyStatus"];

  const crossRigBeads = useMemo(() => {
    if (!threadRig) return [];
    return workedBeads.filter((bead) => {
      const beadRig = bead.rig ?? inferRigFromBeadId(bead.beadId);
      return beadRig !== undefined && beadRig !== threadRig;
    });
  }, [workedBeads, threadRig]);

  return (
    <div className="flex h-full w-[320px] shrink-0 flex-col border-l border-border/70 bg-card/50">
      <div className="flex h-12 shrink-0 items-center justify-between border-b border-border/60 px-3">
        <div className="flex items-center gap-2">
          <Badge
            variant="secondary"
            className="rounded-md bg-violet-500/10 px-1.5 py-0 text-[10px] font-semibold tracking-wide text-violet-600 uppercase dark:bg-violet-400/10 dark:text-violet-400/85"
          >
            GC Context
          </Badge>
          {metadata["gc.runtimeProvider"] ? (
            <span className="text-[11px] text-muted-foreground/60">
              {metadata["gc.runtimeProvider"]}
            </span>
          ) : null}
        </div>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-4 p-3">
          <div className="space-y-3">
            <SectionHeader>Session</SectionHeader>
            <ContextRow label="Agent" value={session?.sessionName ?? metadata["gc.agent"]} />
            <ContextRow label="Rig" value={session?.rig ?? metadata["gc.rig"]} />
            {session ? (
              <div className="space-y-1">
                <div className="text-[10px] font-semibold tracking-widest text-muted-foreground/45 uppercase">
                  State
                </div>
                <div className="flex items-center gap-1.5">
                  <span
                    className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${
                      session.state === "active"
                        ? "bg-green-500"
                        : session.state === "draining" || session.state === "creating"
                          ? "bg-yellow-500"
                          : session.state === "stopped" || session.state === "archived"
                            ? "bg-muted-foreground/30"
                            : session.state === "quarantined" || session.state === "orphaned"
                              ? "bg-red-500"
                              : "bg-muted-foreground/30"
                    }`}
                  />
                  <span className="text-[13px] leading-snug text-foreground/85">
                    {session.state}
                  </span>
                  {session.running ? (
                    <Badge
                      variant="secondary"
                      className="rounded-md bg-green-500/10 px-1.5 py-0 text-[10px] font-semibold text-green-700 uppercase dark:bg-green-400/10 dark:text-green-400"
                    >
                      running
                    </Badge>
                  ) : null}
                  {session.attached ? (
                    <Badge
                      variant="secondary"
                      className="rounded-md bg-blue-500/10 px-1.5 py-0 text-[10px] font-semibold text-blue-700 uppercase dark:bg-blue-400/10 dark:text-blue-400"
                    >
                      attached
                    </Badge>
                  ) : null}
                </div>
              </div>
            ) : (
              <ContextRow label="State" value={metadata["gc.state"]} />
            )}
            <ContextRow
              label="Provider"
              value={session?.provider ?? metadata["gc.runtimeProvider"]}
            />
            <ContextRow label="Template" value={session?.template} />
            <ContextRow label="Kind" value={session?.kind} />
            <ContextRow label="Pool" value={session?.pool} />
            <ContextRow label="Model" value={session?.model ?? metadata["gc.startupModel"]} />
            {session?.contextPct != null ? (
              <div className="space-y-1">
                <div className="text-[10px] font-semibold tracking-widest text-muted-foreground/45 uppercase">
                  Context
                </div>
                <div className="flex items-center gap-2">
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted/40">
                    <div
                      className={`h-full rounded-full transition-all ${
                        session.contextPct > 80
                          ? "bg-red-500"
                          : session.contextPct > 60
                            ? "bg-yellow-500"
                            : "bg-green-500"
                      }`}
                      style={{ width: `${Math.min(100, session.contextPct)}%` }}
                    />
                  </div>
                  <span className="shrink-0 text-[11px] tabular-nums text-foreground/70">
                    {session.contextPct}%
                    {session.contextWindow != null
                      ? ` / ${session.contextWindow.toLocaleString()}`
                      : ""}
                  </span>
                </div>
              </div>
            ) : null}
            <ContextRow label="Activity" value={session?.activity} />
            <ContextRow label="Active Bead" value={session?.activeBead} />
            <ContextRow label="Session ID" value={session?.id} />
            {session?.lastActive ? (
              <ContextRow
                label="Last Active"
                value={new Date(session.lastActive).toLocaleString()}
              />
            ) : null}
          </div>

          <div className="space-y-3">
            <SectionHeader>Bead</SectionHeader>
            <ContextRow label="ID" value={metadata["gc.bead"]} />
            <ContextRow label="Title" value={metadata["gc.beadTitle"]} />
            {beadStatus ? (
              <div className="space-y-1">
                <div className="text-[10px] font-semibold tracking-widest text-muted-foreground/45 uppercase">
                  Status
                </div>
                <div className="flex items-center gap-1.5">
                  <span
                    className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${
                      beadStatus === "closed"
                        ? "bg-green-500"
                        : beadStatus === "in_progress"
                          ? "bg-yellow-500"
                          : "bg-muted-foreground/30"
                    }`}
                  />
                  <span className="text-[13px] leading-snug text-foreground/85">{beadStatus}</span>
                </div>
              </div>
            ) : null}
            <ContextRow label="Type" value={beadType} />
            <ContextRow label="Priority" value={beadPriority} />
            <ContextRow label="Assignee" value={beadAssignee} />
            <ContextRow label="Labels" value={beadLabels} />
            {beadDescription ? (
              <div className="space-y-1">
                <div className="text-[10px] font-semibold tracking-widest text-muted-foreground/45 uppercase">
                  Description
                </div>
                <div className="break-words text-[12px] leading-relaxed text-foreground/75 whitespace-pre-wrap">
                  {beadDescription}
                </div>
              </div>
            ) : null}
          </div>

          <div className="space-y-3">
            <SectionHeader>Convoy</SectionHeader>
            <ContextRow
              label="Convoy"
              value={convoy?.title ?? metadata["gc.convoyTitle"] ?? metadata["gc.convoy"]}
            />
            <ContextRow label="Status" value={effectiveConvoyStatus} />
            <ContextRow label="Progress" value={effectiveConvoyProgress} />
            {convoy && convoy.children.length > 0 ? (
              <div className="space-y-1.5">
                <div className="text-[10px] font-semibold tracking-widest text-muted-foreground/45 uppercase">
                  Children
                </div>
                <div className="space-y-1">
                  {convoy.children.map((child) => (
                    <div key={child.id} className="flex items-center gap-1.5 text-[11px]">
                      <span
                        className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${
                          child.status === "closed"
                            ? "bg-green-500"
                            : child.status === "in_progress"
                              ? "bg-yellow-500"
                              : "bg-muted-foreground/30"
                        }`}
                      />
                      <span className="truncate text-foreground/75">{child.title || child.id}</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </div>

          {formula ? (
            <div className="space-y-3">
              <SectionHeader>Formula: {formula.name}</SectionHeader>
              {formula.description ? (
                <div className="text-[11px] text-muted-foreground/60">{formula.description}</div>
              ) : null}
              <div className="space-y-1.5">
                {formula.steps.map((step, index) => (
                  <div key={step.id} className="rounded-md border border-border/50 px-2 py-1.5">
                    <div className="flex items-start gap-1.5">
                      <span className="shrink-0 text-[10px] font-semibold text-muted-foreground/50">
                        {index + 1}/{formula.steps.length}
                      </span>
                      <div className="min-w-0">
                        <div className="text-[12px] font-medium leading-snug text-foreground/85">
                          {step.title}
                        </div>
                        {step.description ? (
                          <div className="mt-0.5 text-[11px] leading-snug text-muted-foreground/60">
                            {step.description}
                          </div>
                        ) : null}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <SectionHeader>Workflow</SectionHeader>
              <ContextRow label="Formula" value={workflowFormula} />
              <ContextRow label="Molecule" value={workflowMolecule} />
              <ContextRow
                label="Completed Beads"
                value={
                  completedWorkedBeads.length > 0 ? String(completedWorkedBeads.length) : undefined
                }
              />
              <ContextRow
                label="Latest Completed"
                value={latestWorkedBead?.beadTitle ?? latestWorkedBead?.beadId}
              />
            </div>
          )}

          <div className="space-y-3">
            <SectionHeader>Runtime</SectionHeader>
            <ContextRow label="Template" value={metadata["gc.startupTemplate"]} />
            <ContextRow label="Model" value={metadata["gc.startupModel"]} />
            <ContextRow label="Workdir" value={metadata["gc.startupWorkDir"]} />
          </div>

          <div className="space-y-3">
            <SectionHeader>Dolt</SectionHeader>
            <ContextRow label="Database" value={metadata["gc.doltDatabase"]} />
            <ContextRow label="Port" value={metadata["gc.doltPort"]} />
          </div>

          {workedBeads.length > 0 ? (
            <div className="space-y-3">
              <SectionHeader>Worked Beads</SectionHeader>
              <div className="space-y-2">
                {workedBeads.map((bead) => {
                  const beadRig = bead.rig ?? inferRigFromBeadId(bead.beadId);
                  const isCrossRig =
                    threadRig !== undefined && beadRig !== undefined && beadRig !== threadRig;
                  return (
                    <button
                      key={bead.id}
                      type="button"
                      className={`w-full rounded-lg border px-2.5 py-2 text-left transition-colors ${
                        isCrossRig
                          ? "border-cyan-500/30 bg-cyan-500/[0.06] hover:bg-cyan-500/[0.1]"
                          : "border-border/60 bg-background/45 hover:bg-background/70"
                      }`}
                      onClick={() => onSelectWorkedBead?.(bead.sourceEventId)}
                    >
                      <div className="flex flex-wrap items-center gap-1.5">
                        <div className="text-[12px] font-medium text-foreground/85">
                          {contextValue(bead.beadTitle, bead.beadId)}
                        </div>
                        {beadRig ? (
                          <Badge
                            variant="secondary"
                            className={`rounded-md px-1.5 py-0 text-[10px] font-semibold uppercase ${
                              isCrossRig
                                ? "bg-cyan-500/15 text-cyan-700 dark:bg-cyan-400/15 dark:text-cyan-300/90"
                                : "bg-muted/60 text-muted-foreground/70"
                            }`}
                          >
                            {beadRig}
                          </Badge>
                        ) : null}
                        {bead.beadStatus ? (
                          <Badge
                            variant="secondary"
                            className="rounded-md px-1.5 py-0 text-[10px] uppercase"
                          >
                            {bead.beadStatus}
                          </Badge>
                        ) : null}
                      </div>
                      <div className="mt-1 text-[11px] text-muted-foreground/70">{bead.beadId}</div>
                      {bead.formula || bead.moleculeId ? (
                        <div className="mt-1 flex flex-wrap gap-1">
                          {bead.formula ? (
                            <span className="rounded-md border border-border/60 px-1.5 py-0.5 text-[10px] text-muted-foreground/70">
                              {bead.formula}
                            </span>
                          ) : null}
                          {bead.moleculeId ? (
                            <span className="rounded-md border border-border/60 px-1.5 py-0.5 text-[10px] text-muted-foreground/70">
                              {bead.moleculeId}
                            </span>
                          ) : null}
                        </div>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}

          {crossRigBeads.length > 0 ? (
            <div className="space-y-3">
              <SectionHeader>Cross-Rig References</SectionHeader>
              <div className="text-[11px] text-muted-foreground/60">
                {crossRigBeads.length} bead{crossRigBeads.length !== 1 ? "s" : ""} from other rigs
              </div>
              <div className="flex flex-wrap gap-1">
                {[
                  ...new Set(
                    crossRigBeads.map((b) => b.rig ?? inferRigFromBeadId(b.beadId)).filter(Boolean),
                  ),
                ].map((rig) => (
                  <Badge
                    key={rig}
                    variant="secondary"
                    className="rounded-md bg-cyan-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-cyan-700 uppercase dark:bg-cyan-400/10 dark:text-cyan-300/85"
                  >
                    {rig}
                  </Badge>
                ))}
              </div>
            </div>
          ) : null}

          {gcEvents.length > 0 ? (
            <div className="space-y-3">
              <SectionHeader>GC Events</SectionHeader>
              <div className="space-y-2">
                {gcEvents.map((event) => {
                  const beadRig =
                    event.rig ?? (event.beadId ? inferRigFromBeadId(event.beadId) : undefined);
                  const isBeadEvent = event.kind.startsWith("gc.bead.");
                  return (
                    <div
                      key={event.id}
                      data-gc-event-id={event.id}
                      className="rounded-xl border border-amber-500/25 bg-amber-500/[0.06] px-3 py-2.5"
                    >
                      <div className="flex items-start gap-2">
                        <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center text-amber-600/80 dark:text-amber-300/80">
                          <WrenchIcon className="size-3" />
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <p className="text-[11px] font-medium text-foreground/85">
                              {event.summary}
                            </p>
                            {isBeadEvent && beadRig ? (
                              <span className="rounded-md bg-cyan-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-cyan-700 uppercase dark:bg-cyan-400/15 dark:text-cyan-300/90">
                                {beadRig}
                              </span>
                            ) : null}
                            {event.badges?.map((badge) => (
                              <span
                                key={`${event.id}:${badge}`}
                                className="rounded-md border border-amber-500/20 bg-background/55 px-1.5 py-0.5 text-[10px] text-muted-foreground/75"
                              >
                                {badge}
                              </span>
                            ))}
                          </div>
                          {event.detail && (
                            <p className="mt-1 text-[11px] text-muted-foreground/70">
                              {event.detail}
                            </p>
                          )}
                          {event.textPreview && (
                            <pre className="mt-2 overflow-x-auto rounded-lg border border-border/60 bg-background/65 px-2 py-1.5 whitespace-pre-wrap text-[10px] leading-4 text-muted-foreground/80">
                              {event.textPreview}
                            </pre>
                          )}
                          <p className="mt-1.5 text-[10px] text-muted-foreground/35">
                            {new Date(event.createdAt).toLocaleTimeString()}
                          </p>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : null}
        </div>
      </ScrollArea>
    </div>
  );
});

export default GcContextSidebar;
