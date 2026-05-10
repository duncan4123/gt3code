import "../index.css";

import { ThreadId, type ThreadId as ThreadIdType } from "@t3tools/contracts";
import { page } from "vitest/browser";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import { SidebarGcFolders } from "./SidebarGcFolders";
import { SidebarMenuSub } from "./ui/sidebar";
import type { SidebarGcRigGroup } from "./SidebarGcFolders";

const threadId = (value: string): ThreadIdType => ThreadId.make(value);

function makeRigGroups(): SidebarGcRigGroup[] {
  return [
    {
      id: "t3code",
      label: "t3code",
      kind: "rig",
      isSuspended: false,
      agentGroups: [
        {
          id: "t3code/refinery",
          label: "refinery",
          qualifiedName: "t3code/refinery",
          isExplicitlySuspended: false,
          isSuspended: false,
          isPool: false,
          runtimeState: { label: "Running", tone: "success" },
          threadIds: [threadId("thread-refinery-1"), threadId("thread-refinery-2")],
        },
        {
          id: "t3code/witness",
          label: "witness",
          qualifiedName: "t3code/witness",
          isExplicitlySuspended: true,
          isSuspended: true,
          isPool: false,
          runtimeState: { label: "Suspended", tone: "muted" },
          threadIds: [],
        },
      ],
    },
    {
      id: "GC",
      label: "GC",
      kind: "workspace",
      isSuspended: false,
      agentGroups: [
        {
          id: "mayor",
          label: "mayor",
          qualifiedName: "mayor",
          isExplicitlySuspended: false,
          isSuspended: false,
          isPool: false,
          runtimeState: { label: "Running", tone: "success" },
          threadIds: [threadId("thread-mayor-1")],
        },
        {
          id: "deacon",
          label: "deacon",
          qualifiedName: "deacon",
          isExplicitlySuspended: true,
          isSuspended: true,
          isPool: false,
          runtimeState: { label: "Suspended", tone: "muted" },
          threadIds: [],
        },
      ],
    },
  ];
}

async function renderSidebarGcFolders(options?: {
  rigGroups?: SidebarGcRigGroup[];
  gcAgentMutationsInFlight?: ReadonlySet<string>;
  gcRigMutationsInFlight?: ReadonlySet<string>;
  gcCityMutationInFlight?: boolean;
  onToggleCitySuspended?: (suspended: boolean) => void;
  onToggleRigSuspended?: (rig: string, suspended: boolean) => void;
  onToggleAgentSuspended?: (agent: string, suspended: boolean) => void;
  onAdjustAgentMinActiveSessions?: (agent: string, minActiveSessions: number) => void;
  onAdjustAgentMaxActiveSessions?: (agent: string, maxActiveSessions: number) => void;
  onToggleAgentWakeMode?: (agent: string, wakeMode: "resume" | "fresh") => void;
}) {
  const host = document.createElement("div");
  document.body.append(host);

  const screen = await render(
    <SidebarMenuSub>
      <SidebarGcFolders
        rigGroups={options?.rigGroups ?? makeRigGroups()}
        gcAgentMutationsInFlight={options?.gcAgentMutationsInFlight ?? new Set()}
        gcRigMutationsInFlight={options?.gcRigMutationsInFlight ?? new Set()}
        gcCityMutationInFlight={options?.gcCityMutationInFlight ?? false}
        gcThreadGroupingMode="agent"
        gcAgentActionStateByAgent={new Map()}
        gcRigActionStateByRig={new Map()}
        gcCityActionState={null}
        onToggleCitySuspended={options?.onToggleCitySuspended ?? vi.fn()}
        onToggleRigSuspended={options?.onToggleRigSuspended ?? vi.fn()}
        onToggleAgentSuspended={options?.onToggleAgentSuspended ?? vi.fn()}
        onAdjustAgentMinActiveSessions={options?.onAdjustAgentMinActiveSessions ?? vi.fn()}
        onAdjustAgentMaxActiveSessions={options?.onAdjustAgentMaxActiveSessions ?? vi.fn()}
        onWakeAgentSession={vi.fn()}
        onToggleAgentWakeMode={options?.onToggleAgentWakeMode ?? vi.fn()}
        onToggleAgentSessionMode={vi.fn()}
        renderThreadRows={(threadIds, indentClassName) => (
          <>
            {threadIds.map((threadId) => (
              <div
                key={threadId}
                data-testid={`gc-thread-row-${threadId}`}
                data-indent={indentClassName ?? ""}
              >
                {threadId}
              </div>
            ))}
          </>
        )}
      />
    </SidebarMenuSub>,
    { container: host },
  );

  return {
    host,
    screen,
  };
}

describe("SidebarGcFolders", () => {
  afterEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = "";
  });

  it("renders configured rig folders once and shows play/stop controls for agent state", async () => {
    const toggleCalls: Array<[string, boolean]> = [];
    const onToggleCitySuspended = (suspended: boolean) => {
      toggleCalls.push(["__city__", suspended]);
    };
    const onToggleRigSuspended = (rig: string, suspended: boolean) => {
      toggleCalls.push([rig, suspended]);
    };
    const onToggleAgentSuspended = (agent: string, suspended: boolean) => {
      toggleCalls.push([agent, suspended]);
    };
    const { host, screen } = await renderSidebarGcFolders({
      onToggleCitySuspended,
      onToggleRigSuspended,
      onToggleAgentSuspended,
    });

    try {
      await expect.element(page.getByTestId("gc-rig-folder-t3code")).toBeInTheDocument();
      await expect.element(page.getByTestId("gc-rig-folder-GC")).toBeInTheDocument();
      await expect.element(page.getByTestId("gc-city-label-GC")).toHaveTextContent("city");
      await expect.element(page.getByTestId("gc-city-label-t3code")).not.toBeInTheDocument();
      await expect
        .element(page.getByTestId("gc-agent-folder-t3code--refinery"))
        .toBeInTheDocument();
      await expect.element(page.getByTestId("gc-agent-folder-t3code--witness")).toBeInTheDocument();
      await expect.element(page.getByTestId("gc-agent-folder-mayor")).toBeInTheDocument();
      await expect.element(page.getByTestId("gc-agent-folder-deacon")).toBeInTheDocument();
      await expect.element(page.getByTestId("gc-thread-row-thread-refinery-1")).toBeInTheDocument();
      await expect.element(page.getByTestId("gc-thread-row-thread-refinery-2")).toBeInTheDocument();
      await expect.element(page.getByTestId("gc-thread-row-thread-mayor-1")).toBeInTheDocument();
      await expect
        .element(page.getByTestId("gc-thread-row-thread-refinery-1"))
        .toHaveAttribute("data-indent", "pl-6");
      await expect.element(page.getByTestId("gc-thread-row-thread-mayor-1")).toBeInTheDocument();
      await expect
        .element(page.getByTestId("gc-rig-toggle-t3code"))
        .toHaveAttribute("aria-expanded", "true");
      await expect
        .element(page.getByTestId("gc-rig-action-t3code"))
        .toHaveAttribute("data-gc-action-icon", "stop");
      await expect
        .element(page.getByTestId("gc-rig-action-GC"))
        .toHaveAttribute("data-gc-action-icon", "stop");
      await expect
        .element(page.getByTestId("gc-city-action"))
        .toHaveAttribute("data-gc-action-icon", "stop");
      await expect
        .element(page.getByTestId("gc-agent-folder-toggle-t3code--refinery"))
        .toHaveAttribute("aria-expanded", "true");

      const suspendRefinery = page.getByTestId("gc-agent-toggle-t3code--refinery");
      const resumeWitness = page.getByTestId("gc-agent-toggle-t3code--witness");
      const suspendMayor = page.getByTestId("gc-agent-toggle-mayor");
      const resumeDeacon = page.getByTestId("gc-agent-toggle-deacon");

      await expect.element(suspendRefinery).toHaveAttribute("data-gc-action-icon", "stop");
      await expect.element(resumeWitness).toHaveAttribute("data-gc-action-icon", "play");
      await expect.element(suspendMayor).toHaveAttribute("data-gc-action-icon", "stop");
      await expect.element(resumeDeacon).toHaveAttribute("data-gc-action-icon", "play");

      await suspendRefinery.click();
      expect(toggleCalls).toContainEqual(["t3code/refinery", true]);

      await page.getByTestId("gc-rig-action-t3code").click();
      expect(toggleCalls).toContainEqual(["t3code", true]);

      await page.getByTestId("gc-city-action").click();
      expect(toggleCalls).toContainEqual(["__city__", true]);

      await resumeWitness.click();
      expect(toggleCalls).toContainEqual(["t3code/witness", false]);

      await page.getByTestId("gc-agent-folder-toggle-t3code--refinery").click();
      await expect
        .element(page.getByTestId("gc-agent-folder-toggle-t3code--refinery"))
        .toHaveAttribute("aria-expanded", "false");
      await expect
        .element(page.getByTestId("gc-thread-row-thread-refinery-1"))
        .not.toBeInTheDocument();

      await page.getByTestId("gc-rig-toggle-t3code").click();
      await expect
        .element(page.getByTestId("gc-rig-toggle-t3code"))
        .toHaveAttribute("aria-expanded", "false");
      await expect
        .element(page.getByTestId("gc-agent-folder-t3code--refinery"))
        .not.toBeInTheDocument();
    } finally {
      await screen.unmount();
      host.remove();
    }
  });

  it("labels and nests top-level multicity folders as cities", async () => {
    const { host, screen } = await renderSidebarGcFolders({
      rigGroups: [
        {
          id: "gascity-br",
          label: "gascity-br",
          kind: "workspace",
          isSuspended: false,
          agentGroups: [
            {
              id: "gascity-br/mayor",
              label: "mayor",
              qualifiedName: "gascity-br/mayor",
              isExplicitlySuspended: false,
              isSuspended: false,
              isPool: false,
              runtimeState: { label: "Running", tone: "success" },
              threadIds: [],
            },
          ],
        },
        {
          id: "gascity-br/beads_rust",
          label: "gascity-br/beads_rust",
          kind: "rig",
          isSuspended: false,
          agentGroups: [
            {
              id: "gascity-br/beads_rust/polecat",
              label: "polecat",
              qualifiedName: "gascity-br/beads_rust/polecat",
              isExplicitlySuspended: false,
              isSuspended: false,
              isPool: false,
              runtimeState: { label: "Running", tone: "success" },
              threadIds: [],
            },
          ],
        },
      ],
    });

    try {
      await expect.element(page.getByTestId("gc-city-label-gascity-br")).toHaveTextContent("city");
      await expect
        .element(page.getByTestId("gc-city-label-gascity-br--beads_rust"))
        .not.toBeInTheDocument();
      await expect
        .element(page.getByTestId("gc-rig-folder-gascity-br--beads_rust"))
        .toBeInTheDocument();
      await expect
        .element(page.getByTestId("gc-agent-folder-gascity-br--beads_rust--polecat"))
        .toBeInTheDocument();

      await page.getByTestId("gc-rig-toggle-gascity-br").click();
      await expect
        .element(page.getByTestId("gc-rig-folder-gascity-br--beads_rust"))
        .not.toBeInTheDocument();
    } finally {
      await screen.unmount();
      host.remove();
    }
  });

  it("labels agents inherited from a suspended rig as rig suspended", async () => {
    const toggleCalls: Array<[string, boolean]> = [];
    const { host, screen } = await renderSidebarGcFolders({
      rigGroups: [
        {
          id: "test-rig",
          label: "test-rig",
          kind: "rig",
          isSuspended: true,
          agentGroups: [
            {
              id: "test-rig/refinery",
              label: "refinery",
              qualifiedName: "test-rig/refinery",
              isExplicitlySuspended: false,
              isSuspended: true,
              isPool: false,
              runtimeState: { label: "Suspended", tone: "muted" },
              threadIds: [],
            },
            {
              id: "test-rig/witness",
              label: "witness",
              qualifiedName: "test-rig/witness",
              isExplicitlySuspended: true,
              isSuspended: true,
              isPool: false,
              runtimeState: { label: "Suspended", tone: "muted" },
              threadIds: [],
            },
          ],
        },
      ],
      onToggleAgentSuspended: (agent, suspended) => {
        toggleCalls.push([agent, suspended]);
      },
    });

    try {
      await expect
        .element(page.getByTestId("gc-agent-status-test-rig--refinery"))
        .toHaveTextContent("Rig suspended");
      await expect
        .element(page.getByTestId("gc-agent-status-test-rig--witness"))
        .toHaveTextContent("Suspended");
      await expect
        .element(page.getByTestId("gc-agent-toggle-test-rig--refinery"))
        .toHaveAttribute("data-gc-action-icon", "stop");

      await page.getByTestId("gc-agent-toggle-test-rig--refinery").click();
      expect(toggleCalls).toContainEqual(["test-rig/refinery", true]);
    } finally {
      await screen.unmount();
      host.remove();
    }
  });

  it("hides workspace agent folders and threads when the workspace folder is collapsed", async () => {
    const { host, screen } = await renderSidebarGcFolders();

    try {
      await expect.element(page.getByTestId("gc-agent-folder-mayor")).toBeInTheDocument();
      await expect.element(page.getByTestId("gc-thread-row-thread-mayor-1")).toBeInTheDocument();

      await page.getByTestId("gc-rig-toggle-GC").click();

      await expect
        .element(page.getByTestId("gc-rig-toggle-GC"))
        .toHaveAttribute("aria-expanded", "false");
      await expect.element(page.getByTestId("gc-agent-folder-mayor")).not.toBeInTheDocument();
      await expect
        .element(page.getByTestId("gc-thread-row-thread-mayor-1"))
        .not.toBeInTheDocument();
    } finally {
      await screen.unmount();
      host.remove();
    }
  });

  it("shows loading states and disables controls while mutations are in flight", async () => {
    const onToggleCitySuspended = vi.fn();
    const onToggleRigSuspended = vi.fn();
    const onToggleAgentSuspended = vi.fn();
    const { host, screen } = await renderSidebarGcFolders({
      gcCityMutationInFlight: true,
      gcRigMutationsInFlight: new Set(["t3code"]),
      gcAgentMutationsInFlight: new Set(["t3code/refinery"]),
      onToggleCitySuspended,
      onToggleRigSuspended,
      onToggleAgentSuspended,
    });

    try {
      await expect
        .element(page.getByTestId("gc-city-action"))
        .toHaveAttribute("data-gc-action-icon", "loading");
      await expect
        .element(page.getByTestId("gc-rig-action-t3code"))
        .toHaveAttribute("data-gc-action-icon", "loading");
      await expect
        .element(page.getByTestId("gc-agent-toggle-t3code--refinery"))
        .toHaveAttribute("data-gc-action-icon", "loading");

      await expect.element(page.getByTestId("gc-city-action")).toBeDisabled();
      await expect.element(page.getByTestId("gc-rig-action-t3code")).toBeDisabled();
      await expect.element(page.getByTestId("gc-agent-toggle-t3code--refinery")).toBeDisabled();

      expect(onToggleCitySuspended).not.toHaveBeenCalled();
      expect(onToggleRigSuspended).not.toHaveBeenCalled();
      expect(onToggleAgentSuspended).not.toHaveBeenCalled();
    } finally {
      await screen.unmount();
      host.remove();
    }
  });

  it("shows pool max controls for pool agents and adjusts the target max", async () => {
    const adjustCalls: Array<[string, number]> = [];
    const minAdjustCalls: Array<[string, number]> = [];
    const wakeCalls: Array<[string, "resume" | "fresh"]> = [];
    const { host, screen } = await renderSidebarGcFolders({
      rigGroups: [
        {
          id: "t3code",
          label: "t3code",
          kind: "rig",
          isSuspended: false,
          agentGroups: [
            {
              id: "t3code/polecat",
              label: "polecat",
              qualifiedName: "t3code/polecat",
              isExplicitlySuspended: false,
              isSuspended: false,
              isPool: true,
              minActiveSessions: 1,
              maxActiveSessions: 5,
              wakeMode: "fresh",
              threadIds: [],
              runtimeState: { label: "Pool", tone: "muted" },
            },
          ],
        },
      ],
      onAdjustAgentMaxActiveSessions: (agent, maxActiveSessions) => {
        adjustCalls.push([agent, maxActiveSessions]);
      },
      onAdjustAgentMinActiveSessions: (agent, minActiveSessions) => {
        minAdjustCalls.push([agent, minActiveSessions]);
      },
      onToggleAgentWakeMode: (agent, wakeMode) => {
        wakeCalls.push([agent, wakeMode]);
      },
    });

    try {
      await expect
        .element(page.getByTestId("gc-agent-pool-min-t3code--polecat"))
        .toHaveTextContent("min 1");
      await expect
        .element(page.getByTestId("gc-agent-pool-max-t3code--polecat"))
        .toHaveTextContent("max 5");
      await expect
        .element(page.getByTestId("gc-agent-wake-mode-t3code--polecat"))
        .toHaveTextContent("fresh");
      await expect
        .element(page.getByTestId("gc-agent-session-mode-t3code--polecat"))
        .not.toBeInTheDocument();

      await page.getByTestId("gc-agent-pool-increment-t3code--polecat").click();
      expect(adjustCalls).toContainEqual(["t3code/polecat", 6]);

      await page.getByTestId("gc-agent-pool-decrement-t3code--polecat").click();
      expect(adjustCalls).toContainEqual(["t3code/polecat", 4]);

      await page.getByTestId("gc-agent-pool-min-increment-t3code--polecat").click();
      expect(minAdjustCalls).toContainEqual(["t3code/polecat", 2]);

      await page.getByTestId("gc-agent-pool-min-decrement-t3code--polecat").click();
      expect(minAdjustCalls).toContainEqual(["t3code/polecat", 0]);

      await page.getByTestId("gc-agent-wake-mode-t3code--polecat").click();
      expect(wakeCalls).toContainEqual(["t3code/polecat", "resume"]);
    } finally {
      await screen.unmount();
      host.remove();
    }
  });

  it("does not show pool controls for non-pool named sessions with min and max metadata", async () => {
    const { host, screen } = await renderSidebarGcFolders({
      rigGroups: [
        {
          id: "t3code",
          label: "t3code",
          kind: "rig",
          isSuspended: false,
          agentGroups: [
            {
              id: "t3code/witness",
              label: "witness",
              qualifiedName: "t3code/witness",
              isExplicitlySuspended: false,
              isSuspended: false,
              isPool: false,
              minActiveSessions: 1,
              maxActiveSessions: 3,
              namedSessionMode: "always",
              threadIds: [],
              runtimeState: { label: "No session", tone: "warning" },
            },
          ],
        },
      ],
    });

    try {
      await expect
        .element(page.getByTestId("gc-agent-pool-min-t3code--witness"))
        .not.toBeInTheDocument();
      await expect
        .element(page.getByTestId("gc-agent-pool-max-t3code--witness"))
        .not.toBeInTheDocument();
      await expect
        .element(page.getByTestId("gc-agent-session-mode-t3code--witness"))
        .toHaveTextContent("auto");
    } finally {
      await screen.unmount();
      host.remove();
    }
  });

  it("renders convoy and formula virtual folders under an agent", async () => {
    const { host, screen } = await renderSidebarGcFolders({
      rigGroups: [
        {
          id: "t3code",
          label: "t3code",
          kind: "rig",
          isSuspended: false,
          agentGroups: [
            {
              id: "t3code/crew",
              label: "crew",
              qualifiedName: "t3code/crew",
              isExplicitlySuspended: false,
              isSuspended: false,
              isPool: false,
              runtimeState: { label: "Running", tone: "success" },
              threadIds: [threadId("thread-convoy-1"), threadId("thread-formula-1")],
              threadGroups: [
                {
                  id: "convoy:convoy-1",
                  label: "Sidebar polish",
                  kind: "convoy",
                  status: "open",
                  progressLabel: "1/3",
                  threadIds: [threadId("thread-convoy-1")],
                },
                {
                  id: "formula:mol-sidebar:",
                  label: "mol-sidebar",
                  kind: "formula",
                  threadIds: [threadId("thread-formula-1")],
                },
              ],
            },
          ],
        },
      ],
    });

    try {
      await expect
        .element(page.getByTestId("gc-thread-group-t3code--crew:convoy:convoy-1"))
        .toBeInTheDocument();
      await expect
        .element(page.getByTestId("gc-thread-group-t3code--crew:formula:mol-sidebar:"))
        .toBeInTheDocument();
      await expect.element(page.getByTestId("gc-thread-row-thread-convoy-1")).toBeInTheDocument();
      await page.getByTestId("gc-thread-group-toggle-t3code--crew:convoy:convoy-1").click();
      await expect
        .element(page.getByTestId("gc-thread-row-thread-convoy-1"))
        .not.toBeInTheDocument();
      await expect.element(page.getByTestId("gc-thread-row-thread-formula-1")).toBeInTheDocument();
    } finally {
      await screen.unmount();
      host.remove();
    }
  });
});
