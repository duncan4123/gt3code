import { describe, expect, it } from "vitest";

import {
  buildStampedGcMetadataUpdate,
  deriveCanonicalGcFolderMetadata,
  gcAgentLabel,
} from "./folderMetadata.ts";

describe("gc folder metadata helpers", () => {
  it("derives a rig-scoped canonical folder payload", () => {
    expect(
      deriveCanonicalGcFolderMetadata({
        "gc.agent": "t3code/gastown.crew",
        "gc.rig": "t3code",
      }),
    ).toEqual({
      "gc.groupKind": "rig",
      "gc.groupId": "t3code",
      "gc.groupLabel": "t3code",
      "gc.agentQualified": "t3code/gastown.crew",
      "gc.agentLabel": "crew",
    });
  });

  it("derives a workspace-scoped canonical folder payload when no rig is present", () => {
    expect(
      deriveCanonicalGcFolderMetadata({
        "gc.agent": "gastown.boot",
        "gc.city": "gc",
      }),
    ).toEqual({
      "gc.groupKind": "workspace",
      "gc.groupId": "gc",
      "gc.groupLabel": "GC",
      "gc.agentQualified": "gastown.boot",
      "gc.agentLabel": "boot",
    });
  });

  it("extracts the leaf agent label from slash and dot qualified names", () => {
    expect(gcAgentLabel("t3code/gastown.crew")).toBe("crew");
    expect(gcAgentLabel("gascity/refinery")).toBe("refinery");
  });

  it("stamps missing canonical fields onto an incoming GC metadata update", () => {
    expect(
      buildStampedGcMetadataUpdate({
        incomingMetadata: {
          "gc.agent": "t3code/polecat",
          "gc.rig": "t3code",
          "gc.sessionName": "t3code--polecat-1",
        },
      }),
    ).toEqual({
      "gc.agent": "t3code/polecat",
      "gc.rig": "t3code",
      "gc.sessionName": "t3code--polecat-1",
      "gc.groupKind": "rig",
      "gc.groupId": "t3code",
      "gc.groupLabel": "t3code",
      "gc.agentQualified": "t3code/polecat",
      "gc.agentLabel": "polecat",
    });
  });

  it("backfills canonical fields from existing GC metadata on title-only updates", () => {
    expect(
      buildStampedGcMetadataUpdate({
        existingMetadata: {
          "gc.agent": "t3code/polecat",
          "gc.rig": "t3code",
          "gc.sessionName": "t3code--polecat-1",
        },
      }),
    ).toEqual({
      "gc.groupKind": "rig",
      "gc.groupId": "t3code",
      "gc.groupLabel": "t3code",
      "gc.agentQualified": "t3code/polecat",
      "gc.agentLabel": "polecat",
    });
  });

  it("does nothing for non-GC metadata updates", () => {
    expect(
      buildStampedGcMetadataUpdate({
        incomingMetadata: {
          foo: "bar",
        },
      }),
    ).toEqual({
      foo: "bar",
    });
    expect(buildStampedGcMetadataUpdate({})).toBeUndefined();
  });
});
