import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import type { VcsFreshness } from "@t3tools/contracts";

export const nowFreshness = (source: VcsFreshness["source"] = "live-local") =>
  DateTime.now.pipe(
    Effect.map((observedAt) => ({
      source,
      expiresAt: Option.none(),
      observedAt,
    })),
  );
