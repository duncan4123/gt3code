import {
  ServerSettings,
  type ClaudeModelOptions,
  type CodexModelOptions,
  type CursorModelOptions,
  type OpenCodeModelOptions,
  type ServerSettingsPatch,
} from "@t3tools/contracts";
import { Schema } from "effect";
import { deepMerge } from "./Struct.ts";
import { fromLenientJson } from "./schemaJson.ts";

const ServerSettingsJson = fromLenientJson(ServerSettings);

export interface PersistedServerObservabilitySettings {
  readonly otlpTracesUrl: string | undefined;
  readonly otlpMetricsUrl: string | undefined;
}

export function normalizePersistedServerSettingString(
  value: string | null | undefined,
): string | undefined {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

export function extractPersistedServerObservabilitySettings(input: {
  readonly observability?: {
    readonly otlpTracesUrl?: string;
    readonly otlpMetricsUrl?: string;
  };
}): PersistedServerObservabilitySettings {
  return {
    otlpTracesUrl: normalizePersistedServerSettingString(input.observability?.otlpTracesUrl),
    otlpMetricsUrl: normalizePersistedServerSettingString(input.observability?.otlpMetricsUrl),
  };
}

export function parsePersistedServerObservabilitySettings(
  raw: string,
): PersistedServerObservabilitySettings {
  try {
    const decoded = Schema.decodeUnknownSync(ServerSettingsJson)(raw);
    return extractPersistedServerObservabilitySettings(decoded);
  } catch {
    return { otlpTracesUrl: undefined, otlpMetricsUrl: undefined };
  }
}

function shouldReplaceTextGenerationModelSelection(
  patch: ServerSettingsPatch["textGenerationModelSelection"] | undefined,
): boolean {
  return Boolean(patch && (patch.provider !== undefined || patch.model !== undefined));
}

const withModelSelectionOptions = <Options>(options: Options | undefined) =>
  options ? { options } : {};

function codexSelectionOptions(
  selection: ServerSettingsPatch["textGenerationModelSelection"] | undefined,
): CodexModelOptions | undefined {
  return selection?.provider === "codex" ? selection.options : undefined;
}

function claudeSelectionOptions(
  selection: ServerSettingsPatch["textGenerationModelSelection"] | undefined,
): ClaudeModelOptions | undefined {
  return selection?.provider === "claudeAgent" ? selection.options : undefined;
}

function cursorSelectionOptions(
  selection: ServerSettingsPatch["textGenerationModelSelection"] | undefined,
): CursorModelOptions | undefined {
  return selection?.provider === "cursor" ? selection.options : undefined;
}

function openCodeSelectionOptions(
  selection: ServerSettingsPatch["textGenerationModelSelection"] | undefined,
): OpenCodeModelOptions | undefined {
  return selection?.provider === "opencode" ? selection.options : undefined;
}

/**
 * Applies a server settings patch while treating textGenerationModelSelection as
 * replace-on-provider/model updates. This prevents stale nested options from
 * surviving a reset patch that intentionally omits options.
 */
export function applyServerSettingsPatch(
  current: ServerSettings,
  patch: ServerSettingsPatch,
): ServerSettings {
  const selectionPatch = patch.textGenerationModelSelection;
  const next = deepMerge(current, patch);
  if (!selectionPatch || !shouldReplaceTextGenerationModelSelection(selectionPatch)) {
    return next;
  }

  const provider = selectionPatch.provider ?? current.textGenerationModelSelection.provider;
  const model = selectionPatch.model ?? current.textGenerationModelSelection.model;

  return {
    ...next,
    textGenerationModelSelection:
      provider === "codex"
        ? {
            provider,
            model,
            ...withModelSelectionOptions(codexSelectionOptions(selectionPatch)),
          }
        : provider === "claudeAgent"
          ? {
              provider,
              model,
              ...withModelSelectionOptions(claudeSelectionOptions(selectionPatch)),
            }
          : provider === "cursor"
            ? {
                provider,
                model,
                ...withModelSelectionOptions(cursorSelectionOptions(selectionPatch)),
              }
            : provider === "opencode"
              ? {
                  provider,
                  model,
                  ...withModelSelectionOptions(openCodeSelectionOptions(selectionPatch)),
                }
              : {
                  provider,
                  model,
                },
  };
}
