import { memo } from "react";
import {
  CheckCircle2Icon,
  CircleDotIcon,
  PlayIcon,
  RepeatIcon,
  SendIcon,
  BellIcon,
} from "lucide-react";
import { isGcActivityKind, GcActivityKind } from "@t3tools/contracts";

interface GcActivityCardProps {
  kind: string;
  summary: string;
  payload?: unknown;
}

const KIND_CONFIG: Record<
  string,
  { icon: typeof CheckCircle2Icon; label: string; colorClass: string }
> = {
  [GcActivityKind.BeadClaimed]: {
    icon: CircleDotIcon,
    label: "Bead claimed",
    colorClass: "text-blue-500",
  },
  [GcActivityKind.BeadClosed]: {
    icon: CheckCircle2Icon,
    label: "Bead completed",
    colorClass: "text-green-500",
  },
  [GcActivityKind.SessionStarted]: {
    icon: PlayIcon,
    label: "Session started",
    colorClass: "text-emerald-500",
  },
  [GcActivityKind.SessionReused]: {
    icon: RepeatIcon,
    label: "Session reused",
    colorClass: "text-amber-500",
  },
  [GcActivityKind.PromptSent]: {
    icon: SendIcon,
    label: "Prompt sent",
    colorClass: "text-muted-foreground",
  },
  [GcActivityKind.NudgeSent]: {
    icon: BellIcon,
    label: "Nudge sent",
    colorClass: "text-muted-foreground",
  },
  [GcActivityKind.StateChanged]: {
    icon: CircleDotIcon,
    label: "State changed",
    colorClass: "text-muted-foreground",
  },
};

/** Check if a work entry kind is a GC activity that should use the GC card. */
export function isGcWorkEntry(kind: string | undefined): boolean {
  return kind !== undefined && isGcActivityKind(kind);
}

const GcActivityCard = memo(function GcActivityCard({
  kind,
  summary,
  payload,
}: GcActivityCardProps) {
  const config = KIND_CONFIG[kind];
  if (!config) return null;

  const Icon = config.icon;
  const beadTitle =
    payload && typeof payload === "object" && "beadTitle" in payload
      ? String((payload as Record<string, unknown>).beadTitle)
      : null;

  return (
    <div className="flex items-start gap-2 rounded-lg px-1 py-1">
      <Icon className={`mt-0.5 size-3.5 shrink-0 ${config.colorClass}`} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] font-medium text-foreground/80">{config.label}</span>
        </div>
        <p className="text-[11px] leading-relaxed text-muted-foreground/70">
          {beadTitle ?? summary}
        </p>
      </div>
    </div>
  );
});

export default GcActivityCard;
