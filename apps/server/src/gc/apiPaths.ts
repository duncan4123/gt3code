interface RawCityLike {
  readonly name?: unknown;
  readonly path?: unknown;
  readonly running?: unknown;
  readonly status?: unknown;
}

interface RawCitiesEnvelope {
  readonly items?: unknown;
  readonly body?: {
    readonly items?: unknown;
  };
}

function normalizeCityEntries(raw: unknown): ReadonlyArray<RawCityLike> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return [];
  }
  const envelope = raw as RawCitiesEnvelope;
  const items = Array.isArray(envelope.items)
    ? envelope.items
    : Array.isArray(envelope.body?.items)
      ? envelope.body.items
      : [];
  return items.filter((entry): entry is RawCityLike => Boolean(entry) && typeof entry === "object");
}

export function resolveGcCityNameFromSupervisorCities(input: {
  readonly raw: unknown;
  readonly cityPath: string | null;
  readonly preferredName?: string | null;
}): string | null {
  const preferredName = input.preferredName?.trim();
  if (preferredName) {
    return preferredName;
  }

  const cities = normalizeCityEntries(input.raw);
  if (cities.length === 0) {
    return null;
  }

  if (input.cityPath) {
    const matchingPath = cities.find(
      (city) => typeof city.path === "string" && city.path.trim() === input.cityPath,
    );
    if (
      matchingPath?.running === true &&
      typeof matchingPath.name === "string" &&
      matchingPath.name.trim().length > 0
    ) {
      return matchingPath.name.trim();
    }
  }

  const runningCities = cities.filter((city) => city.running === true);
  if (runningCities.length === 1) {
    const runningCity = runningCities[0];
    if (typeof runningCity?.name === "string" && runningCity.name.trim().length > 0) {
      return runningCity.name.trim();
    }
  }

  if (input.cityPath) {
    const matchingPath = cities.find(
      (city) => typeof city.path === "string" && city.path.trim() === input.cityPath,
    );
    if (typeof matchingPath?.name === "string" && matchingPath.name.trim().length > 0) {
      return matchingPath.name.trim();
    }
  }

  if (cities.length === 1 && typeof cities[0]?.name === "string") {
    const onlyName = cities[0].name.trim();
    if (onlyName.length > 0) return onlyName;
  }

  return null;
}

export function buildGcCityPath(cityName: string, suffix: string): string {
  const normalizedCityName = cityName.trim();
  const normalizedSuffix = suffix.startsWith("/") ? suffix : `/${suffix}`;
  return `/v0/city/${encodeURIComponent(normalizedCityName)}${normalizedSuffix}`;
}

export function splitGcQualifiedName(value: string): {
  readonly dir: string | null;
  readonly base: string;
} {
  const trimmed = value.trim();
  const separatorIndex = trimmed.indexOf("/");
  if (separatorIndex <= 0 || separatorIndex === trimmed.length - 1) {
    return { dir: null, base: trimmed };
  }
  return {
    dir: trimmed.slice(0, separatorIndex),
    base: trimmed.slice(separatorIndex + 1),
  };
}

export function buildGcAgentActionPath(
  cityName: string,
  agentName: string,
  action: "suspend" | "resume",
): string {
  const { dir, base } = splitGcQualifiedName(agentName);
  return dir
    ? buildGcCityPath(
        cityName,
        `/agent/${encodeURIComponent(dir)}/${encodeURIComponent(base)}/${action}`,
      )
    : buildGcCityPath(cityName, `/agent/${encodeURIComponent(base)}/${action}`);
}

export function buildGcRigActionPath(
  cityName: string,
  rigName: string,
  action: "suspend" | "resume",
): string {
  return buildGcCityPath(cityName, `/rig/${encodeURIComponent(rigName.trim())}/${action}`);
}

export function extractGcProblemMessage(
  status: number,
  rawText: string | null | undefined,
): string {
  if (!rawText || rawText.trim().length === 0) {
    return `GC API returned ${status}`;
  }

  try {
    const parsed = JSON.parse(rawText) as {
      readonly detail?: unknown;
      readonly message?: unknown;
      readonly error?: unknown;
      readonly title?: unknown;
    };
    const detail =
      typeof parsed.detail === "string" && parsed.detail.trim().length > 0
        ? parsed.detail.trim()
        : null;
    const message =
      typeof parsed.message === "string" && parsed.message.trim().length > 0
        ? parsed.message.trim()
        : null;
    const error =
      typeof parsed.error === "string" && parsed.error.trim().length > 0
        ? parsed.error.trim()
        : null;
    const title =
      typeof parsed.title === "string" && parsed.title.trim().length > 0
        ? parsed.title.trim()
        : null;
    return detail ?? message ?? error ?? title ?? `GC API returned ${status}`;
  } catch {
    return rawText.trim() || `GC API returned ${status}`;
  }
}
