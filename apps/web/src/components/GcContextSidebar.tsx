import { memo, useMemo } from "react";
import type { GcThreadContextResult } from "@t3tools/contracts";
import { parseGcMeta } from "@t3tools/contracts";
import { Badge } from "./ui/badge";
import { ScrollArea } from "./ui/scroll-area";

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
    <div className="text-[10px] font-semibold tracking-widest text-muted-foreground/40 uppercase">
      {children}
    </div>
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
      <div className="flex h-full items-center justify-center px-6 text-center text-sm text-muted-foreground">
        No GC context available for this thread.
      </div>
    );
  }

  return (
    <ScrollArea className="h-full">
      <div className="flex flex-col gap-5 p-4">
        {/* Identity */}
        <div className="flex flex-col gap-3">
          <SectionHeader>Agent</SectionHeader>
          <ContextRow label="Agent" value={gcMeta.agent} />
          <ContextRow label="Rig" value={gcMeta.rig} />
          <ContextRow label="Provider" value={gcMeta.runtimeProvider ?? gcMeta.provider} />
          {gcMeta.state && (
            <div>
              <Badge variant={gcMeta.state === "active" ? "default" : "secondary"}>
                {gcMeta.state}
              </Badge>
            </div>
          )}
        </div>

        {/* Current Bead */}
        {(gcMeta.bead || threadContext?.bead) && (
          <div className="flex flex-col gap-3">
            <SectionHeader>Current Work</SectionHeader>
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
          </div>
        )}

        {/* Convoy */}
        {(gcMeta.convoy || convoy) && (
          <div className="flex flex-col gap-3">
            <SectionHeader>Convoy</SectionHeader>
            <ContextRow
              label="Convoy"
              value={convoy?.title ?? gcMeta.convoyTitle ?? gcMeta.convoy}
            />
            <ContextRow
              label="Status"
              value={convoy?.status ?? gcMeta.convoyStatus}
            />
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
                    className="flex items-center justify-between rounded px-2 py-1 text-[12px] hover:bg-muted"
                    onClick={() => onSelectWorkedBead?.(child.id)}
                  >
                    <span className="truncate">{child.title}</span>
                    <Badge variant={child.status === "closed" ? "secondary" : "outline"} className="ml-2 shrink-0">
                      {child.status}
                    </Badge>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Formula */}
        {(gcMeta.formula || threadContext?.formula) && (
          <div className="flex flex-col gap-3">
            <SectionHeader>Formula</SectionHeader>
            <ContextRow label="Formula" value={threadContext?.formula?.name ?? gcMeta.formula} />
            {gcMeta.molecule && <ContextRow label="Molecule" value={gcMeta.molecule} />}
          </div>
        )}
      </div>
    </ScrollArea>
  );
});

export default GcContextSidebar;
