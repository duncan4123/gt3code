import * as Context from "effect/Context";

import type { GitManagerShape } from "../../git/Services/GitManager.ts";

export interface JjManagerShape extends GitManagerShape {}

export class JjManager extends Context.Service<JjManager, JjManagerShape>()(
  "t3/jj/Services/JjManager",
) {}
