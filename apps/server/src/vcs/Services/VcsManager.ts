import * as Context from "effect/Context";

import type { GitManagerShape } from "../../git/Services/GitManager.ts";

export interface VcsManagerShape extends GitManagerShape {}

export class VcsManager extends Context.Service<VcsManager, VcsManagerShape>()(
  "t3/vcs/Services/VcsManager",
) {}
