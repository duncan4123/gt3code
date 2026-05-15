import { Context } from "effect";

import type { GitCoreShape } from "../../git/Services/GitCore.ts";

export interface VcsCoreShape extends GitCoreShape {}

export class VcsCore extends Context.Service<VcsCore, VcsCoreShape>()("t3/vcs/Services/VcsCore") {}
