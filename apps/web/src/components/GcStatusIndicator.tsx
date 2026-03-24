import { useEffect, useState } from "react";
import { getTransportState, onTransportStateChange, type TransportState } from "../wsNativeApi";
import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";

function statusFor(state: TransportState): { color: string; pulse: boolean; label: string } {
  switch (state) {
    case "open":
      return { color: "bg-green-500", pulse: false, label: "GC connected" };
    case "connecting":
      return { color: "bg-amber-400", pulse: true, label: "GC connecting…" };
    case "reconnecting":
      return { color: "bg-amber-400", pulse: true, label: "GC reconnecting…" };
    case "closed":
      return { color: "bg-red-500", pulse: false, label: "GC disconnected" };
    case "disposed":
      return { color: "bg-red-500", pulse: false, label: "GC offline" };
  }
}

export function GcStatusIndicator() {
  const [state, setState] = useState<TransportState>(getTransportState);

  useEffect(() => {
    setState(getTransportState());
    return onTransportStateChange(setState);
  }, []);

  const { color, pulse, label } = statusFor(state);

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span className="inline-flex items-center gap-1.5 px-2 py-1 text-xs text-muted-foreground/60 select-none cursor-default">
            <span className="relative inline-flex size-2">
              {pulse && (
                <span
                  className={`absolute inline-flex size-full rounded-full ${color} opacity-75 animate-ping`}
                />
              )}
              <span className={`relative inline-flex size-2 rounded-full ${color}`} />
            </span>
            GC
          </span>
        }
      />
      <TooltipPopup side="top">{label}</TooltipPopup>
    </Tooltip>
  );
}
