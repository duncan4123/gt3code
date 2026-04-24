import { memo, type ReactNode, useMemo } from "react";
import type { GcThreadContextResult } from "@t3tools/contracts";
import { parseGcMeta } from "@t3tools/contracts";
import { Badge } from "./ui/badge";
import {
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarSeparator,
} from "./ui/sidebar";

interface GcContextSidebarProps {
  metadata: Record<string, string>;
  threadContext?: GcThreadContextResult | null;
  onSelectWorkedBead?: (beadId: string) => void;
}

function ContextRow({
  label,
  value,
  mono = false,
  showEmpty = false,
}: {
  label: string;
  value: string | number | undefined | null;
  mono?: boolean;
  showEmpty?: boolean;
}) {
  const display = typeof value === "number" ? String(value) : value?.trim();
  if (!display && !showEmpty) return null;
  return (
    <div className="grid grid-cols-[76px_minmax(0,1fr)] items-baseline gap-2">
      <div className="text-[9px] font-semibold tracking-widest text-muted-foreground/45 uppercase">
        {label}
      </div>
      <div
        className={[
          "min-w-0 break-words text-[12px] leading-snug text-foreground/85",
          mono ? "font-mono text-[12px]" : "",
        ].join(" ")}
      >
        {display || "—"}
      </div>
    </div>
  );
}

function SectionHeader({ children }: { children: ReactNode }) {
  return (
    <SidebarGroupLabel className="h-auto px-0 text-[9px] font-semibold tracking-widest text-muted-foreground/40 uppercase">
      {children}
    </SidebarGroupLabel>
  );
}

function SectionCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <SidebarGroup className="px-3 py-1.5">
      <div className="rounded-xl border border-sidebar-border/70 bg-sidebar-accent/20 p-2.5 shadow-sm">
        <SectionHeader>{title}</SectionHeader>
        <SidebarGroupContent className="space-y-2 pt-1.5">{children}</SidebarGroupContent>
      </div>
    </SidebarGroup>
  );
}

function StatusBadge({ status }: { status: string | undefined | null }) {
  if (!status?.trim()) return null;
  const normalized = status.trim();
  const variant =
    normalized === "closed" || normalized === "archived"
      ? "secondary"
      : normalized === "active" || normalized === "in_progress"
        ? "default"
        : "outline";
  return <Badge variant={variant}>{normalized}</Badge>;
}

function ProgressBar({ closed, total }: { closed: number; total: number }) {
  const percent = total > 0 ? Math.min(100, Math.max(0, Math.round((closed / total) * 100))) : 0;
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-[10px] text-muted-foreground">
        <span>
          {closed}/{total} completed
        </span>
        <span>{percent}%</span>
      </div>
      <div className="h-1 rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-primary transition-all"
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}

function parseCount(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return Math.floor(parsed);
}

function metadataValue(
  metadata: Record<string, string> | undefined,
  keys: ReadonlyArray<string>,
): string | undefined {
  if (!metadata) return undefined;
  for (const key of keys) {
    const value = metadata[key]?.trim();
    if (value) return value;
  }
  return undefined;
}

function compactList(values: ReadonlyArray<string> | undefined, limit = 4): string | undefined {
  if (!values || values.length === 0) return undefined;
  const visible = values.slice(0, limit).join(", ");
  return values.length > limit ? `${visible}, +${values.length - limit}` : visible;
}

const RUNTIME_ENV_KEY_ORDER = [
  "GC_AGENT",
  "GC_ALIAS",
  "GC_TEMPLATE",
  "GC_SESSION_NAME",
  "GC_SESSION_ID",
  "GC_SESSION_ORIGIN",
  "GC_RUNTIME_EPOCH",
  "GC_CONTINUATION_EPOCH",
  "GC_PROVIDER",
  "GC_RIG",
  "GC_RIG_ROOT",
  "GC_CITY",
  "GC_CITY_PATH",
  "GC_CITY_ROOT",
  "GC_DIR",
  "GC_BEAD",
  "GC_BEAD_ID",
  "GC_CONVOY",
  "GC_FORMULA",
  "GC_MOLECULE",
  "GC_API_URL",
  "GC_DOLT_HOST",
  "GC_DOLT_PORT",
] as const;

const RUNTIME_ENV_PREFIXES = ["GC_", "GT_", "BEADS_"] as const;
const SENSITIVE_RUNTIME_ENV_KEY_PATTERN =
  /(?:TOKEN|SECRET|PASSWORD|PASS|PRIVATE|CREDENTIAL|COOKIE|API_KEY|ACCESS_KEY|AUTH)/i;

function getRuntimeEnvRows(sessionEnv: Record<string, string> | undefined) {
  if (!sessionEnv) return [];
  const order: ReadonlyMap<string, number> = new Map(
    RUNTIME_ENV_KEY_ORDER.map((key, index) => [key, index]),
  );
  return Object.entries(sessionEnv)
    .filter(([key, value]) => {
      if (!value.trim()) return false;
      return RUNTIME_ENV_PREFIXES.some((prefix) => key.startsWith(prefix));
    })
    .map(([key, value]) => ({
      key,
      value: SENSITIVE_RUNTIME_ENV_KEY_PATTERN.test(key) ? "redacted" : value,
      redacted: SENSITIVE_RUNTIME_ENV_KEY_PATTERN.test(key),
    }))
    .sort((left, right) => {
      const leftOrder = order.get(left.key) ?? Number.MAX_SAFE_INTEGER;
      const rightOrder = order.get(right.key) ?? Number.MAX_SAFE_INTEGER;
      if (leftOrder !== rightOrder) return leftOrder - rightOrder;
      return left.key.localeCompare(right.key);
    });
}

function RuntimeEnvRows({ rows }: { rows: ReturnType<typeof getRuntimeEnvRows> }) {
  if (rows.length === 0) {
    return (
      <div className="rounded-lg bg-background/60 px-2 py-1.5 text-[12px] leading-snug text-muted-foreground">
        No GC runtime env snapshot has been published for this thread.
      </div>
    );
  }
  return (
    <div className="max-h-56 space-y-1 overflow-auto pr-1">
      {rows.map((row) => (
        <div
          key={row.key}
          className="grid grid-cols-[116px_minmax(0,1fr)] gap-2 rounded-lg bg-background/60 px-2 py-1.5"
        >
          <div className="font-mono text-[10px] tracking-tight text-muted-foreground">
            {row.key}
          </div>
          <div
            className={[
              "min-w-0 break-words font-mono text-[11px] leading-snug text-foreground/85",
              row.redacted ? "text-muted-foreground/70 italic" : "",
            ].join(" ")}
          >
            {row.value}
          </div>
        </div>
      ))}
    </div>
  );
}

function FormulaSteps({
  steps,
}: {
  steps: NonNullable<GcThreadContextResult["formula"]>["steps"] | undefined;
}) {
  if (!steps || steps.length === 0) return null;
  return (
    <div className="space-y-1.5">
      <div className="text-[9px] font-semibold tracking-widest text-muted-foreground/45 uppercase">
        Steps
      </div>
      <div className="space-y-1">
        {steps.slice(0, 5).map((step, index) => (
          <div key={step.id} className="rounded-lg bg-background/60 px-2 py-1.5">
            <div className="flex gap-2 text-[12px] leading-snug text-foreground/85">
              <span className="font-mono text-muted-foreground">{index + 1}</span>
              <span className="min-w-0 flex-1 truncate">{step.title}</span>
            </div>
            {step.needs && step.needs.length > 0 && (
              <div className="mt-0.5 truncate pl-5 text-[10px] text-muted-foreground">
                needs {step.needs.join(", ")}
              </div>
            )}
          </div>
        ))}
        {steps.length > 5 && (
          <div className="text-[10px] text-muted-foreground">+{steps.length - 5} more steps</div>
        )}
      </div>
    </div>
  );
}

const GcContextSidebar = memo(function GcContextSidebar({
  metadata,
  threadContext,
  onSelectWorkedBead,
}: GcContextSidebarProps) {
  const gcMeta = useMemo(() => parseGcMeta(metadata), [metadata]);

  const bead = threadContext?.bead ?? null;
  const convoy = threadContext?.convoy ?? null;
  const formula = threadContext?.formula ?? null;
  const metadataClosedCount = parseCount(gcMeta.convoyClosedCount);
  const metadataTotalCount = parseCount(gcMeta.convoyTotalCount);
  const convoyProgress = convoy
    ? { closed: convoy.closedCount, total: convoy.totalCount }
    : metadataClosedCount !== null && metadataTotalCount !== null
      ? { closed: metadataClosedCount, total: metadataTotalCount }
      : null;
  const hookBeadId = bead?.id ?? gcMeta.bead;
  const hookFormula = formula?.name ?? gcMeta.formula ?? bead?.ref;
  const hookMolecule = gcMeta.molecule ?? bead?.metadata?.molecule_id;
  const runtimeEnvRows = useMemo(() => getRuntimeEnvRows(gcMeta.sessionEnv), [gcMeta.sessionEnv]);
  const beadMetadata = bead?.metadata;
  const worktreePath = metadataValue(beadMetadata, ["work_dir", "worktree", "worktree_path"]);
  const sourceBranch = metadataValue(beadMetadata, ["branch", "source_branch", "git_branch"]);
  const targetBranch = metadataValue(beadMetadata, [
    "target",
    "target_branch",
    "base_branch",
    "merged_target",
  ]);
  const routedTo = metadataValue(beadMetadata, ["gc.routed_to", "routed_to"]);
  const rejectionReason = metadataValue(beadMetadata, ["rejection_reason"]);
  const mergeStrategy = metadataValue(beadMetadata, ["merge_strategy"]);
  const mergeResult = metadataValue(beadMetadata, ["merge_result"]);
  const prUrl = metadataValue(beadMetadata, ["pr_url"]);
  const prNumber = metadataValue(beadMetadata, ["pr_number"]);
  const recovered = metadataValue(beadMetadata, ["recovered"]);
  const sessionWorkDir = gcMeta.startupWorkDir ?? gcMeta.sessionEnv?.GC_DIR;
  const rigRoot = gcMeta.rigPath ?? gcMeta.sessionEnv?.GC_RIG_ROOT;
  const hasBranchContext = Boolean(
    worktreePath ||
    sourceBranch ||
    targetBranch ||
    routedTo ||
    rejectionReason ||
    mergeStrategy ||
    mergeResult ||
    prUrl ||
    prNumber ||
    recovered ||
    sessionWorkDir ||
    rigRoot,
  );

  if (!gcMeta.isGcManaged) {
    return (
      <>
        <SidebarHeader className="gap-1 px-4 py-3">
          <div className="text-xs font-semibold tracking-wide text-foreground/90 uppercase">
            GC Context
          </div>
        </SidebarHeader>
        <SidebarSeparator />
        <SidebarContent className="gap-0">
          <SidebarGroup className="px-4 py-4">
            <SidebarGroupContent>
              <div className="text-sm leading-relaxed text-muted-foreground">
                No GC context available for this thread.
              </div>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
      </>
    );
  }

  return (
    <>
      <SidebarHeader className="gap-1 px-4 py-3">
        <div className="flex items-center justify-between gap-2">
          <div className="text-xs font-semibold tracking-wide text-foreground/90 uppercase">
            GC Context
          </div>
          <StatusBadge status={gcMeta.state} />
        </div>
        <div className="text-[11px] text-muted-foreground/70">
          {gcMeta.agentLabel ?? gcMeta.agent ?? "Managed thread"}
        </div>
      </SidebarHeader>
      <SidebarSeparator />
      <SidebarContent className="gap-0">
        <SectionCard title="Agent">
          <ContextRow label="Agent" value={gcMeta.agent} showEmpty />
          <ContextRow label="Rig" value={gcMeta.rig} />
          <ContextRow label="Rig Root" value={rigRoot} mono />
          <ContextRow label="Provider" value={gcMeta.runtimeProvider ?? gcMeta.provider} />
          <ContextRow label="Session" value={gcMeta.sessionName} mono />
          <ContextRow label="Template" value={gcMeta.startupTemplate} />
          <ContextRow label="Model" value={gcMeta.startupModel} />
          <ContextRow label="City" value={gcMeta.city} />
        </SectionCard>

        {(hookBeadId || bead) && (
          <SectionCard title="Hooked Work">
            <div className="flex flex-wrap items-center gap-1.5">
              <StatusBadge status={bead?.status} />
              {bead?.issueType && <Badge variant="outline">{bead.issueType}</Badge>}
              {typeof bead?.priority === "number" && (
                <Badge variant="secondary">P{bead.priority}</Badge>
              )}
            </div>
            <ContextRow
              label="Title"
              value={bead?.title ?? gcMeta.beadTitle ?? hookBeadId}
              showEmpty
            />
            <ContextRow label="Bead ID" value={hookBeadId} mono />
            <ContextRow label="Parent" value={bead?.parentId} mono />
            <ContextRow label="Assignee" value={bead?.assignee} />
            <ContextRow label="Formula Ref" value={bead?.ref ?? hookFormula} mono />
            <ContextRow label="Labels" value={compactList(bead?.labels)} />
            <ContextRow label="Created" value={bead?.createdAt} mono />
            <ContextRow label="Updated" value={bead?.updatedAt} mono />
            {bead?.description && <ContextRow label="Description" value={bead.description} />}
          </SectionCard>
        )}

        {hasBranchContext && (
          <SectionCard title="Branch / Worktree">
            <ContextRow label="Worktree" value={worktreePath} mono />
            <ContextRow label="Session Dir" value={sessionWorkDir} mono />
            <ContextRow label="Branch" value={sourceBranch} mono />
            <ContextRow label="Target" value={targetBranch} mono />
            <ContextRow label="Routed To" value={routedTo} />
            <ContextRow label="Merge Mode" value={mergeStrategy} />
            <ContextRow label="Merge Result" value={mergeResult} />
            <ContextRow label="PR" value={prUrl ?? prNumber} mono />
            <ContextRow label="Recovered" value={recovered} />
            <ContextRow label="Rejected" value={rejectionReason} />
          </SectionCard>
        )}

        <SectionCard title="Runtime Env">
          <div className="text-[11px] leading-snug text-muted-foreground">
            GC env forwarded to the provider process. Sensitive values are redacted.
          </div>
          <RuntimeEnvRows rows={runtimeEnvRows} />
        </SectionCard>

        {(gcMeta.groupKind ||
          gcMeta.groupId ||
          gcMeta.groupLabel ||
          gcMeta.agentQualified ||
          gcMeta.agentLabel) && (
          <SectionCard title="Folder">
            <ContextRow label="Kind" value={gcMeta.groupKind} />
            <ContextRow label="Group ID" value={gcMeta.groupId} mono />
            <ContextRow label="Label" value={gcMeta.groupLabel} />
            <ContextRow label="Qualified Agent" value={gcMeta.agentQualified} />
            <ContextRow label="Agent Label" value={gcMeta.agentLabel} />
          </SectionCard>
        )}

        {(gcMeta.convoy || convoy) && (
          <SectionCard title="Convoy">
            <ContextRow
              label="Convoy"
              value={convoy?.title ?? gcMeta.convoyTitle ?? gcMeta.convoy}
            />
            <ContextRow label="Convoy ID" value={convoy?.id ?? gcMeta.convoy} mono />
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge status={convoy?.status ?? gcMeta.convoyStatus} />
            </div>
            {convoyProgress && (
              <ProgressBar closed={convoyProgress.closed} total={convoyProgress.total} />
            )}
            {convoy?.children && convoy.children.length > 0 && (
              <div className="flex flex-col gap-1">
                <SectionHeader>Children</SectionHeader>
                {convoy.children.map((child) => (
                  <button
                    key={child.id}
                    type="button"
                    className="flex items-center justify-between rounded-lg px-2 py-1.5 text-left text-[12px] hover:bg-background/70"
                    onClick={() => onSelectWorkedBead?.(child.id)}
                  >
                    <span className="min-w-0 truncate">{child.title}</span>
                    <Badge
                      variant={child.status === "closed" ? "secondary" : "outline"}
                      className="ml-2 shrink-0"
                    >
                      {child.status}
                    </Badge>
                  </button>
                ))}
              </div>
            )}
          </SectionCard>
        )}

        {(hookFormula || hookMolecule || formula) && (
          <SectionCard title="Formula">
            <ContextRow label="Formula" value={hookFormula} mono />
            <ContextRow label="Molecule" value={hookMolecule} mono />
            <ContextRow label="Version" value={formula?.version} />
            {formula?.description && <ContextRow label="Description" value={formula.description} />}
            <FormulaSteps steps={formula?.steps} />
          </SectionCard>
        )}
      </SidebarContent>
    </>
  );
});

export default GcContextSidebar;
