import type { ProviderInstanceEnvironment } from "@t3tools/contracts";

export function mergeProviderInstanceEnvironment(
  environment: ProviderInstanceEnvironment | undefined,
  baseEnv: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  if (!environment || environment.length === 0) {
    return baseEnv;
  }

  const next: NodeJS.ProcessEnv = { ...baseEnv };
  for (const variable of environment) {
    next[variable.name] = variable.value;
  }
  return next;
}

export function mergeProviderSessionEnvironment(
  baseEnv: NodeJS.ProcessEnv | undefined,
  sessionEnv: Record<string, string> | undefined,
): NodeJS.ProcessEnv {
  if (!sessionEnv || Object.keys(sessionEnv).length === 0) {
    return baseEnv ?? process.env;
  }
  return {
    ...(baseEnv ?? process.env),
    ...sessionEnv,
  };
}
