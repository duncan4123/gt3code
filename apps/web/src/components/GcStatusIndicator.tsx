import { useEffect, useState } from "react";

import { getTransportState, onTransportStateChange } from "../wsNativeApi";
import type { TransportState } from "../wsTransport";
import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";

function statusFor(state: TransportState): {
  colorClass: string;
  label: string;
  pulse: boolean;
} {
  switch (state) {
    case "open":
      return { colorClass: "bg-green-500", label: "GC connected", pulse: false };
    case "connecting":
      return { colorClass: "bg-amber-400", label: "GC connecting...", pulse: true };
    case "reconnecting":
      return { colorClass: "bg-amber-400", label: "GC reconnecting...", pulse: true };
    case "closed":
      return { colorClass: "bg-red-500", label: "GC disconnected", pulse: false };
    case "disposed":
      return { colorClass: "bg-red-500", label: "GC offline", pulse: false };
    default:
      return { colorClass: "bg-red-500", label: "GC offline", pulse: false };
  }
}

export function GcStatusIndicator() {
  const [state, setState] = useState<TransportState>(getTransportState);

  useEffect(() => {
    setState(getTransportState());
    const unsubscribe = onTransportStateChange(setState);
    return () => {
      unsubscribe?.();
    };
  }, []);

  const { colorClass, label, pulse } = statusFor(state);

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span className="inline-flex cursor-default select-none items-center gap-1.5 px-2 py-1 text-xs text-muted-foreground/60">
            <span className="relative inline-flex size-2">
              {pulse ? (
                <span
                  className={`absolute inline-flex size-full animate-ping rounded-full ${colorClass} opacity-75`}
                />
              ) : null}
              <span className={`relative inline-flex size-2 rounded-full ${colorClass}`} />
            </span>
            GC
          </span>
        }
      />
      <TooltipPopup side="top">{label}</TooltipPopup>
    </Tooltip>
  );
}
