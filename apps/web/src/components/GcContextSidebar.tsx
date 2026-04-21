import { memo, useMemo } from "react";
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

function ContextRow({ label, value }: { label: string; value: string | undefined }) {
  return (
    <div className="space-y-1">
      <div className="text-[10px] font-semibold tracking-widest text-muted-foreground/45 uppercase">
        {label}
      </div>
      <div className="break-words text-[13px] leading-snug text-foreground/85">
        {value?.trim() || "—"}
      </div>
    </div>
  );
}

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <SidebarGroupLabel className="h-auto px-0 text-[10px] font-semibold tracking-widest text-muted-foreground/40 uppercase">
      {children}
    </SidebarGroupLabel>
  );
}

function ProgressBar({ closed, total }: { closed: number; total: number }) {
  const percent = total > 0 ? Math.round((closed / total) * 100) : 0;
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-[11px] text-muted-foreground">
        <span>
          {closed}/{total} completed
        </span>
        <span>{percent}%</span>
      </div>
      <div className="h-1.5 rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-primary transition-all"
          style={{ width: `${percent}%` }}
        />
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

  const convoy = threadContext?.convoy ?? null;
  const convoyProgress = convoy
    ? { closed: convoy.closedCount, total: convoy.totalCount }
    : gcMeta.convoyClosedCount && gcMeta.convoyTotalCount
      ? { closed: Number(gcMeta.convoyClosedCount), total: Number(gcMeta.convoyTotalCount) }
      : null;

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
        <div className="text-xs font-semibold tracking-wide text-foreground/90 uppercase">
          GC Context
        </div>
        <div className="text-[11px] text-muted-foreground/70">
          {gcMeta.agent ?? "Managed thread"}
        </div>
      </SidebarHeader>
      <SidebarSeparator />
      <SidebarContent className="gap-0">
        <SidebarGroup className="px-4 py-3">
          <SectionHeader>Agent</SectionHeader>
          <SidebarGroupContent className="space-y-3 pt-1">
            <ContextRow label="Agent" value={gcMeta.agent} />
            <ContextRow label="Rig" value={gcMeta.rig} />
            <ContextRow label="Provider" value={gcMeta.runtimeProvider ?? gcMeta.provider} />
            <ContextRow label="Session" value={gcMeta.sessionName} />
            <ContextRow label="City" value={gcMeta.city} />
            {gcMeta.state && (
              <div>
                <Badge variant={gcMeta.state === "active" ? "default" : "secondary"}>
                  {gcMeta.state}
                </Badge>
              </div>
            )}
          </SidebarGroupContent>
        </SidebarGroup>

        {(gcMeta.groupKind ||
          gcMeta.groupId ||
          gcMeta.groupLabel ||
          gcMeta.agentQualified ||
          gcMeta.agentLabel) && (
          <SidebarGroup className="px-4 py-3">
            <SectionHeader>Folder</SectionHeader>
            <SidebarGroupContent className="space-y-3 pt-1">
              <ContextRow label="Kind" value={gcMeta.groupKind} />
              <ContextRow label="Group ID" value={gcMeta.groupId} />
              <ContextRow label="Label" value={gcMeta.groupLabel} />
              <ContextRow label="Qualified Agent" value={gcMeta.agentQualified} />
              <ContextRow label="Agent Label" value={gcMeta.agentLabel} />
            </SidebarGroupContent>
          </SidebarGroup>
        )}

        {(gcMeta.bead || threadContext?.bead) && (
          <SidebarGroup className="px-4 py-3">
            <SectionHeader>Current Work</SectionHeader>
            <SidebarGroupContent className="space-y-3 pt-1">
              <ContextRow
                label="Bead"
                value={threadContext?.bead?.title ?? gcMeta.beadTitle ?? gcMeta.bead}
              />
              {threadContext?.bead?.description && (
                <ContextRow label="Description" value={threadContext.bead.description} />
              )}
              {threadContext?.bead && (
                <div>
                  <Badge
                    variant={
                      threadContext.bead.status === "closed"
                        ? "secondary"
                        : threadContext.bead.status === "in_progress"
                          ? "default"
                          : "outline"
                    }
                  >
                    {threadContext.bead.status}
                  </Badge>
                </div>
              )}
            </SidebarGroupContent>
          </SidebarGroup>
        )}

        {(gcMeta.convoy || convoy) && (
          <SidebarGroup className="px-4 py-3">
            <SectionHeader>Convoy</SectionHeader>
            <SidebarGroupContent className="space-y-3 pt-1">
              <ContextRow
                label="Convoy"
                value={convoy?.title ?? gcMeta.convoyTitle ?? gcMeta.convoy}
              />
              <ContextRow label="Status" value={convoy?.status ?? gcMeta.convoyStatus} />
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
                      className="flex items-center justify-between rounded-md px-2 py-1.5 text-[12px] hover:bg-muted"
                      onClick={() => onSelectWorkedBead?.(child.id)}
                    >
                      <span className="truncate">{child.title}</span>
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
            </SidebarGroupContent>
          </SidebarGroup>
        )}

        {(gcMeta.formula || threadContext?.formula) && (
          <SidebarGroup className="px-4 py-3">
            <SectionHeader>Formula</SectionHeader>
            <SidebarGroupContent className="space-y-3 pt-1">
              <ContextRow label="Formula" value={threadContext?.formula?.name ?? gcMeta.formula} />
              {gcMeta.molecule && <ContextRow label="Molecule" value={gcMeta.molecule} />}
            </SidebarGroupContent>
          </SidebarGroup>
        )}
      </SidebarContent>
    </>
  );
});

export default GcContextSidebar;
