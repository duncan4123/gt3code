const DEFAULT_GC_CITY = "gc";

function trimToUndefined(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function normalizedIdentifier(value: string | undefined): string | undefined {
  const trimmed = trimToUndefined(value);
  if (!trimmed || trimmed === "." || trimmed === ".." || trimmed === "/") {
    return undefined;
  }
  return trimmed;
}

function normalizedLeafName(value: string | undefined): string | undefined {
  const trimmed = normalizedIdentifier(value);
  if (!trimmed) {
    return undefined;
  }
  const normalized = trimmed.replace(/\\/g, "/").replace(/\/+$/, "");
  const segments = normalized.split("/").filter(Boolean);
  const leaf = segments.at(-1) ?? normalized;
  if (!leaf || leaf === "." || leaf === "..") {
    return undefined;
  }
  return leaf;
}

function parseSessionEnv(value: string | undefined): Record<string, string> | undefined {
  if (!value) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return undefined;
    }
    return Object.fromEntries(
      Object.entries(parsed).flatMap(([key, entryValue]) =>
        typeof entryValue === "string" ? [[key, entryValue] as const] : [],
      ),
    );
  } catch {
    return undefined;
  }
}

function gcCityName(customMetadata: Readonly<Record<string, string | undefined>>): string {
  const sessionEnv = parseSessionEnv(customMetadata["gc.sessionEnv"]);
  return (
    normalizedLeafName(customMetadata["gc.city"]) ??
    normalizedLeafName(sessionEnv?.GC_CITY_NAME) ??
    normalizedLeafName(sessionEnv?.GC_CITY_PATH) ??
    normalizedLeafName(sessionEnv?.GC_CITY_ROOT) ??
    normalizedLeafName(sessionEnv?.GC_CITY) ??
    DEFAULT_GC_CITY
  );
}

function shouldCityScopeFolderMetadata(city: string): boolean {
  return city !== DEFAULT_GC_CITY;
}

function cityScopedRigId(city: string, rig: string): string {
  if (
    !shouldCityScopeFolderMetadata(city) ||
    rig === city ||
    rig.includes("/") ||
    rig.startsWith(`${city}/`)
  ) {
    return rig;
  }
  return `${city}/${rig}`;
}

export function gcAgentLabel(agentQualified: string): string {
  const slash = agentQualified.lastIndexOf("/");
  const scoped = slash >= 0 ? agentQualified.slice(slash + 1) : agentQualified;
  const dot = scoped.lastIndexOf(".");
  return dot >= 0 ? scoped.slice(dot + 1) : scoped;
}

function gcAgentQualifiedName(input: {
  agent: string;
  city: string;
  groupId: string;
  rig: string | undefined;
}): string {
  if (!shouldCityScopeFolderMetadata(input.city)) {
    return input.agent;
  }

  if (input.agent === input.groupId || input.agent.startsWith(`${input.groupId}/`)) {
    return input.agent;
  }

  const rigCandidates = [
    normalizedIdentifier(input.rig),
    normalizedLeafName(input.rig),
  ].filter((candidate): candidate is string => Boolean(candidate));
  for (const candidate of new Set(rigCandidates)) {
    if (input.agent.startsWith(`${candidate}/`)) {
      return `${input.groupId}/${input.agent.slice(candidate.length + 1)}`;
    }
  }

  return `${input.groupId}/${input.agent}`;
}

export function deriveCanonicalGcFolderMetadata(
  customMetadata: Readonly<Record<string, string | undefined>>,
): Record<string, string> | undefined {
  const agent = trimToUndefined(customMetadata["gc.agent"]);
  if (!agent) {
    return undefined;
  }

  const rig = normalizedIdentifier(customMetadata["gc.rig"]);
  const city = gcCityName(customMetadata);
  const groupId = rig ? cityScopedRigId(city, rig) : city;
  const agentQualified = gcAgentQualifiedName({ agent, city, groupId, rig });

  return {
    "gc.groupKind": rig ? "rig" : "workspace",
    "gc.groupId": groupId,
    "gc.groupLabel": rig ?? city.toUpperCase(),
    "gc.agentQualified": agentQualified,
    "gc.agentLabel": gcAgentLabel(agentQualified),
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
