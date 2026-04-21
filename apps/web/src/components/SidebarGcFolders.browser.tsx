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
          isSuspended: false,
          isPool: false,
          runtimeState: { label: "Running", tone: "success" },
          threadIds: [threadId("thread-refinery-1"), threadId("thread-refinery-2")],
        },
        {
          id: "t3code/witness",
          label: "witness",
          qualifiedName: "t3code/witness",
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
          isSuspended: false,
          isPool: false,
          runtimeState: { label: "Running", tone: "success" },
          threadIds: [threadId("thread-mayor-1")],
        },
        {
          id: "deacon",
          label: "deacon",
          qualifiedName: "deacon",
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
  onAdjustAgentMaxActiveSessions?: (agent: string, maxActiveSessions: number) => void;
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
        gcAgentActionStateByAgent={new Map()}
        gcRigActionStateByRig={new Map()}
        gcCityActionState={null}
        onToggleCitySuspended={options?.onToggleCitySuspended ?? vi.fn()}
        onToggleRigSuspended={options?.onToggleRigSuspended ?? vi.fn()}
        onToggleAgentSuspended={options?.onToggleAgentSuspended ?? vi.fn()}
        onAdjustAgentMaxActiveSessions={options?.onAdjustAgentMaxActiveSessions ?? vi.fn()}
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
              isSuspended: false,
              isPool: true,
              maxActiveSessions: 5,
              threadIds: [],
              runtimeState: { label: "Pool", tone: "muted" },
            },
          ],
        },
      ],
      onAdjustAgentMaxActiveSessions: (agent, maxActiveSessions) => {
        adjustCalls.push([agent, maxActiveSessions]);
      },
    });

    try {
      await expect
        .element(page.getByTestId("gc-agent-pool-max-t3code--polecat"))
        .toHaveTextContent("max 5");
      await expect
        .element(page.getByTestId("gc-agent-session-mode-t3code--polecat"))
        .not.toBeInTheDocument();

      await page.getByTestId("gc-agent-pool-increment-t3code--polecat").click();
      expect(adjustCalls).toContainEqual(["t3code/polecat", 6]);

      await page.getByTestId("gc-agent-pool-decrement-t3code--polecat").click();
      expect(adjustCalls).toContainEqual(["t3code/polecat", 4]);
    } finally {
      await screen.unmount();
      host.remove();
    }
  });
});
