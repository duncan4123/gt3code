import "../index.css";

import { page } from "vitest/browser";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import { SidebarGcFolders } from "./SidebarGcFolders";
import { SidebarMenuSub } from "./ui/sidebar";

describe("SidebarGcFolders", () => {
  afterEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = "";
  });

  it("renders configured rig folders once and shows play/stop controls for agent state", async () => {
    const toggleSpy = vi.fn();
    const host = document.createElement("div");
    document.body.append(host);

    const screen = await render(
      <SidebarMenuSub>
        <SidebarGcFolders
          rigGroups={[
            {
              id: "t3code",
              label: "t3code",
              isSuspended: false,
              agentGroups: [
                {
                  id: "t3code/refinery",
                  label: "refinery",
                  qualifiedName: "t3code/refinery",
                  isSuspended: false,
                  threadIds: [],
                },
                {
                  id: "t3code/witness",
                  label: "witness",
                  qualifiedName: "t3code/witness",
                  isSuspended: true,
                  threadIds: [],
                },
              ],
            },
            {
              id: "GC",
              label: "GC",
              isSuspended: false,
              agentGroups: [
                {
                  id: "mayor",
                  label: "mayor",
                  qualifiedName: "mayor",
                  isSuspended: false,
                  threadIds: [],
                },
                {
                  id: "deacon",
                  label: "deacon",
                  qualifiedName: "deacon",
                  isSuspended: true,
                  threadIds: [],
                },
              ],
            },
          ]}
          gcAgentMutationsInFlight={new Set()}
          gcRigMutationsInFlight={new Set()}
          onToggleRigSuspended={toggleSpy}
          onToggleAgentSuspended={toggleSpy}
          renderThreadRows={() => null}
        />
      </SidebarMenuSub>,
      { container: host },
    );

    try {
      await expect.element(page.getByTestId("gc-rig-folder-t3code")).toBeInTheDocument();
      await expect.element(page.getByTestId("gc-rig-folder-GC")).toBeInTheDocument();
      await expect
        .element(page.getByTestId("gc-agent-folder-t3code--refinery"))
        .toBeInTheDocument();
      await expect.element(page.getByTestId("gc-agent-folder-t3code--witness")).toBeInTheDocument();
      await expect.element(page.getByTestId("gc-agent-folder-mayor")).toBeInTheDocument();
      await expect.element(page.getByTestId("gc-agent-folder-deacon")).toBeInTheDocument();
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
      expect(toggleSpy).toHaveBeenCalledWith("t3code/refinery", true);

      await page.getByTestId("gc-rig-action-t3code").click();
      expect(toggleSpy).toHaveBeenCalledWith("t3code", true);

      await resumeWitness.click();
      expect(toggleSpy).toHaveBeenCalledWith("t3code/witness", false);

      await page.getByTestId("gc-agent-folder-toggle-t3code--refinery").click();
      await expect
        .element(page.getByTestId("gc-agent-folder-toggle-t3code--refinery"))
        .toHaveAttribute("aria-expanded", "false");

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
});
