export function mergeSessionEnvironment(
  base: NodeJS.ProcessEnv | undefined,
  session: Record<string, string> | undefined,
): NodeJS.ProcessEnv | undefined {
  if (!base && !session) {
    return undefined;
  }
  return {
    ...(base ?? {}),
    ...(session ?? {}),
  };
}
