import * as Context from "effect/Context";

import type { GitCoreShape } from "../../git/Services/GitCore.ts";

export interface JjCoreShape extends GitCoreShape {}

export class JjCore extends Context.Service<JjCore, JjCoreShape>()("t3/jj/Services/JjCore") {}
