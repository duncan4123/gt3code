const DEFAULT_GC_CITY = "gc";

function trimToUndefined(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export function gcAgentLabel(agentQualified: string): string {
  const slash = agentQualified.lastIndexOf("/");
  const scoped = slash >= 0 ? agentQualified.slice(slash + 1) : agentQualified;
  const dot = scoped.lastIndexOf(".");
  return dot >= 0 ? scoped.slice(dot + 1) : scoped;
}

export function deriveCanonicalGcFolderMetadata(
  customMetadata: Readonly<Record<string, string | undefined>>,
): Record<string, string> | undefined {
  const agent = trimToUndefined(customMetadata["gc.agent"]);
  if (!agent) {
    return undefined;
  }

  const rig = trimToUndefined(customMetadata["gc.rig"]);
  const city = trimToUndefined(customMetadata["gc.city"]) ?? DEFAULT_GC_CITY;

  return {
    "gc.groupKind": rig ? "rig" : "workspace",
    "gc.groupId": rig ?? city,
    "gc.groupLabel": rig ?? city.toUpperCase(),
    "gc.agentQualified": agent,
    "gc.agentLabel": gcAgentLabel(agent),
  };
}

export function buildStampedGcMetadataUpdate(input: {
  readonly existingMetadata?: Readonly<Record<string, string>>;
  readonly incomingMetadata?: Readonly<Record<string, string>>;
}): Record<string, string> | undefined {
  const nextMetadata = input.incomingMetadata ? { ...input.incomingMetadata } : {};
  const mergedMetadata = {
    ...(input.existingMetadata ?? {}),
    ...nextMetadata,
  };
  const canonicalMetadata = deriveCanonicalGcFolderMetadata(mergedMetadata);

  if (canonicalMetadata) {
    for (const [key, value] of Object.entries(canonicalMetadata)) {
      if (mergedMetadata[key] !== value) {
        nextMetadata[key] = value;
      }
    }
  }

  return Object.keys(nextMetadata).length > 0 ? nextMetadata : undefined;
}
