/**
 * Platform-aware MCP tool naming.
 * Each platform has its own convention for how MCP tool names appear to the LLM.
 *
 * Evidence-based naming conventions (from official docs):
 * | Platform           | Pattern                                                    |
 * |--------------------|------------------------------------------------------------|
 * | Claude Code        | mcp__plugin_context-mode-doltlite_context-mode-doltlite__<tool>               |
 * | Gemini CLI         | mcp__context-mode-doltlite__<tool>                                  |
 * | Antigravity        | mcp__context-mode-doltlite__<tool>                                  |
 * | OpenCode           | context-mode-doltlite_<tool>                                        |
 * | VS Code Copilot    | context-mode-doltlite_<tool>                                        |
 * | Kiro               | @context-mode-doltlite/<tool>                                       |
 * | Zed                | mcp:context-mode-doltlite:<tool>                                    |
 * | Cursor / Codex / OpenClaw / Pi | bare <tool>                                    |
 */

const TOOL_PREFIXES = {
  "claude-code":    (tool) => `mcp__plugin_context-mode-doltlite_context-mode-doltlite__${tool}`,
  "gemini-cli":     (tool) => `mcp__context-mode-doltlite__${tool}`,
  "antigravity":    (tool) => `mcp__context-mode-doltlite__${tool}`,
  "opencode":       (tool) => `context-mode-doltlite_${tool}`,
  "kilo":           (tool) => `context-mode-doltlite_${tool}`,
  "vscode-copilot": (tool) => `context-mode-doltlite_${tool}`,
  "kiro":           (tool) => `@context-mode-doltlite/${tool}`,
  "zed":            (tool) => `mcp:context-mode-doltlite:${tool}`,
  "cursor":         (tool) => tool,
  "codex":          (tool) => tool,
  "openclaw":       (tool) => tool,
  "pi":             (tool) => tool,
};

/**
 * Get the platform-specific MCP tool name for a bare tool name.
 * Falls back to claude-code convention if platform is unknown.
 */
export function getToolName(platform, bareTool) {
  const fn = TOOL_PREFIXES[platform] || TOOL_PREFIXES["claude-code"];
  return fn(bareTool);
}

/**
 * Create a namer function bound to a specific platform.
 * Returns (bareTool) => platformSpecificToolName.
 */
export function createToolNamer(platform) {
  return (bareTool) => getToolName(platform, bareTool);
}

/** List of all known platform IDs. */
export const KNOWN_PLATFORMS = Object.keys(TOOL_PREFIXES);
