import { memo } from "react";
import { type WorkLogEntry, stripTrailingExitCode } from "../../session-logic";
import { cn } from "~/lib/utils";

interface ToolCallDetailProps {
  workEntry: WorkLogEntry;
  payload: unknown;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function extractToolInput(payload: unknown): Record<string, unknown> | null {
  const record = asRecord(payload);
  const data = asRecord(record?.data);
  const item = asRecord(data?.item);
  const input = asRecord(item?.input);
  if (input && Object.keys(input).length > 0) {
    return input;
  }
  // Fallback: if there's a command at item level, surface it
  const command = item?.command;
  if (typeof command === "string" && command.length > 0) {
    return { command };
  }
  return null;
}

function extractToolOutput(payload: unknown): string | null {
  const record = asRecord(payload);
  // Primary: payload.detail (full output string)
  if (typeof record?.detail === "string" && record.detail.length > 0) {
    const { output } = stripTrailingExitCode(record.detail);
    return output;
  }
  // Fallback: payload.data.item.result.content or payload.data.item.result as string
  const data = asRecord(record?.data);
  const item = asRecord(data?.item);
  const result = item?.result;
  if (typeof result === "string" && result.length > 0) {
    return result;
  }
  const resultRecord = asRecord(result);
  if (typeof resultRecord?.content === "string" && resultRecord.content.length > 0) {
    return resultRecord.content;
  }
  return null;
}

function formatInputValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value === null || value === undefined) return "null";
  return JSON.stringify(value, null, 2);
}

export const ToolCallDetail = memo(function ToolCallDetail({
  workEntry,
  payload,
}: ToolCallDetailProps) {
  const input = extractToolInput(payload);
  const output = extractToolOutput(payload);
  const changedFiles = workEntry.changedFiles ?? [];
  const hasContent = input !== null || output !== null || changedFiles.length > 0;

  if (!hasContent) {
    return (
      <div className="pl-7 pt-1 pb-1">
        <p className="text-[11px] text-muted-foreground/50 italic">No details available</p>
      </div>
    );
  }

  return (
    <div className="pl-7 pt-1.5 pb-1">
      <div className="space-y-2 rounded-lg border border-border/30 bg-muted/30 p-2">
        {input !== null && (
          <div>
            <p className="mb-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">
              Input
            </p>
            <div className="rounded-md bg-background/50 p-2">
              <dl className="space-y-0.5">
                {Object.entries(input).map(([key, value]) => (
                  <div key={key} className="flex gap-2 font-mono text-[11px]">
                    <dt className="shrink-0 text-muted-foreground">{key}:</dt>
                    <dd
                      className={cn(
                        "min-w-0 break-all text-foreground/90",
                        typeof value === "string" && value.length > 120
                          ? "whitespace-pre-wrap"
                          : "truncate",
                      )}
                      title={formatInputValue(value)}
                    >
                      {formatInputValue(value)}
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          </div>
        )}

        {output !== null && (
          <div>
            <p className="mb-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">
              Output
            </p>
            <div className="max-h-[300px] overflow-y-auto rounded-md bg-background/50 p-2">
              <pre className="whitespace-pre-wrap break-all font-mono text-xs text-foreground/85">
                {output}
              </pre>
            </div>
          </div>
        )}

        {changedFiles.length > 0 && (
          <div>
            <p className="mb-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">
              Changed files
            </p>
            <div className="flex flex-wrap gap-1">
              {changedFiles.map((filePath) => (
                <span
                  key={filePath}
                  className="rounded-md border border-border/55 bg-background/75 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground/75"
                  title={filePath}
                >
                  {filePath}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
});
