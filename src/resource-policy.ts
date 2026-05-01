export const FULL_TEST_SUITE_OVERRIDE_ENV = "CONTEXT_MODE_ALLOW_FULL_TESTS";

const TEST_SCRIPT_RUNNERS = new Set(["npm", "pnpm", "yarn", "bun"]);

export function shouldBlockFullTestSuiteCommand(
  command: string,
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  if (env[FULL_TEST_SUITE_OVERRIDE_ENV] === "1") return null;
  return describeFullTestSuiteCommand(command);
}

export function describeFullTestSuiteCommand(command: string): string | null {
  for (const segment of splitShellSegments(command)) {
    const tokens = tokenizeShellSegment(segment);
    if (tokens.length === 0) continue;

    const executable = basename(tokens[0]);
    const args = tokens.slice(1);

    if (executable === "make" && ["test", "check"].includes(args[0] ?? "")) {
      return `make ${args[0]}`;
    }

    if (executable === "go" && args[0] === "test" && isFullGoTest(args.slice(1))) {
      return "go test ./...";
    }

    if (TEST_SCRIPT_RUNNERS.has(executable) && isUnscopedJsTestCommand(executable, args)) {
      return `${executable} test`;
    }

    if (executable === "pytest" && !hasScopedArgs(args)) {
      return "pytest";
    }

    if (executable === "cargo" && args[0] === "test" && !hasScopedArgs(args.slice(1))) {
      return "cargo test";
    }
  }

  return null;
}

function splitShellSegments(command: string): string[] {
  return command
    .replace(/\s+2>&1\s*$/u, "")
    .split(/\s*(?:&&|\|\||;|\n)\s*/u)
    .map((segment) => segment.trim())
    .filter(Boolean);
}

function tokenizeShellSegment(segment: string): string[] {
  const tokens = segment.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/gu) ?? [];
  return tokens.map((token) => token.replace(/^["']|["']$/gu, ""));
}

function basename(command: string): string {
  return command.split("/").pop() ?? command;
}

function isFullGoTest(args: string[]): boolean {
  return args.includes("./...") || args.length === 0;
}

function isUnscopedJsTestCommand(executable: string, args: string[]): boolean {
  if (executable === "bun") {
    if (args[0] === "test") return !hasScopedArgs(args.slice(1));
    if (args[0] === "run" && args[1] === "test") return !hasScopedArgs(args.slice(2));
    return false;
  }

  if (args[0] === "test") return !hasScopedArgs(args.slice(1));
  if (args[0] === "run" && args[1] === "test") return !hasScopedArgs(args.slice(2));
  return false;
}

function hasScopedArgs(args: string[]): boolean {
  return args.some((arg) => {
    if (!arg || arg.startsWith("-")) return false;
    if (/^[A-Z_][A-Z0-9_]*=/u.test(arg)) return false;
    return arg !== "./...";
  });
}
