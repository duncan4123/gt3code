import { memo } from "react";
import { Badge } from "./ui/badge";
import { ScrollArea } from "./ui/scroll-area";

interface GcContextSidebarProps {
  metadata: Record<string, string>;
  workedBeads?: ReadonlyArray<{
    id: string;
    beadId: string;
    beadTitle?: string;
    beadStatus?: string;
    formula?: string;
    moleculeId?: string;
    createdAt: string;
    sourceEventId: string;
    sourceKind: string;
  }>;
}

function contextValue(value: string | undefined, fallback = "—") {
  return value && value.trim() ? value : fallback;
}

function ContextRow({
  label,
  value,
}: {
  label: string;
  value: string | undefined;
}) {
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

const GcContextSidebar = memo(function GcContextSidebar({
  metadata,
  workedBeads = [],
}: GcContextSidebarProps) {
  const convoyClosedCount = metadata["gc.convoyClosedCount"];
  const convoyTotalCount = metadata["gc.convoyTotalCount"];
  const convoyProgress =
    convoyClosedCount && convoyTotalCount
      ? `${convoyClosedCount}/${convoyTotalCount}`
      : undefined;

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
            <div className="text-[10px] font-semibold tracking-widest text-muted-foreground/40 uppercase">
              Session
            </div>
            <ContextRow label="Agent" value={metadata["gc.agent"]} />
            <ContextRow label="Rig" value={metadata["gc.rig"]} />
            <ContextRow label="State" value={metadata["gc.state"]} />
            <ContextRow label="Provider" value={metadata["gc.runtimeProvider"]} />
          </div>

          <div className="space-y-3">
            <div className="text-[10px] font-semibold tracking-widest text-muted-foreground/40 uppercase">
              Work
            </div>
            <ContextRow label="Bead" value={metadata["gc.bead"]} />
            <ContextRow label="Task" value={metadata["gc.beadTitle"]} />
            <ContextRow label="Molecule" value={metadata["gc.molecule"]} />
            <ContextRow label="Formula" value={metadata["gc.formula"]} />
            <ContextRow label="Convoy" value={metadata["gc.convoyTitle"] ?? metadata["gc.convoy"]} />
            <ContextRow label="Convoy Status" value={metadata["gc.convoyStatus"]} />
            <ContextRow label="Convoy Progress" value={convoyProgress} />
          </div>

          <div className="space-y-3">
            <div className="text-[10px] font-semibold tracking-widest text-muted-foreground/40 uppercase">
              Runtime
            </div>
            <ContextRow label="Template" value={metadata["gc.startupTemplate"]} />
            <ContextRow label="Model" value={metadata["gc.startupModel"]} />
            <ContextRow label="Workdir" value={metadata["gc.startupWorkDir"]} />
          </div>

          <div className="space-y-3">
            <div className="text-[10px] font-semibold tracking-widest text-muted-foreground/40 uppercase">
              Dolt
            </div>
            <ContextRow label="Database" value={metadata["gc.doltDatabase"]} />
            <ContextRow label="Port" value={metadata["gc.doltPort"]} />
          </div>

          {workedBeads.length > 0 ? (
            <div className="space-y-3">
              <div className="text-[10px] font-semibold tracking-widest text-muted-foreground/40 uppercase">
                Worked Beads
              </div>
              <div className="space-y-2">
                {workedBeads.map((bead) => (
                  <div
                    key={bead.id}
                    className="rounded-lg border border-border/60 bg-background/45 px-2.5 py-2"
                  >
                    <div className="flex flex-wrap items-center gap-1.5">
                      <div className="text-[12px] font-medium text-foreground/85">
                        {contextValue(bead.beadTitle, bead.beadId)}
                      </div>
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
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </ScrollArea>
    </div>
  );
});

export default GcContextSidebar;
