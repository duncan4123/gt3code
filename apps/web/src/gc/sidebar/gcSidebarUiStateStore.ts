import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { resolveStorage } from "../../lib/storage";

const GC_SIDEBAR_UI_STATE_STORAGE_KEY = "t3code:gc-sidebar-ui-state:v1";

type GcSidebarFolderExpandedById = Record<string, boolean>;

interface GcSidebarUiState {
  folderExpandedById: GcSidebarFolderExpandedById;
  toggleFolderExpanded: (folderId: string) => void;
  setFolderExpanded: (folderId: string, expanded: boolean) => void;
}

function createGcSidebarUiStateStorage() {
  return resolveStorage(typeof window !== "undefined" ? window.localStorage : undefined);
}

function normalizeFolderId(folderId: string): string | null {
  const normalized = folderId.trim();
  return normalized.length > 0 ? normalized : null;
}

export function isGcSidebarFolderExpanded(
  expandedById: GcSidebarFolderExpandedById,
  folderId: string,
): boolean {
  return expandedById[folderId] ?? true;
}

export const useGcSidebarUiStateStore = create<GcSidebarUiState>()(
  persist(
    (set) => ({
      folderExpandedById: {},
      toggleFolderExpanded: (folderId) =>
        set((state) => {
          const normalizedFolderId = normalizeFolderId(folderId);
          if (!normalizedFolderId) {
            return state;
          }
          const current = isGcSidebarFolderExpanded(state.folderExpandedById, normalizedFolderId);
          return {
            folderExpandedById: {
              ...state.folderExpandedById,
              [normalizedFolderId]: !current,
            },
          };
        }),
      setFolderExpanded: (folderId, expanded) =>
        set((state) => {
          const normalizedFolderId = normalizeFolderId(folderId);
          if (
            !normalizedFolderId ||
            isGcSidebarFolderExpanded(state.folderExpandedById, normalizedFolderId) === expanded
          ) {
            return state;
          }
          return {
            folderExpandedById: {
              ...state.folderExpandedById,
              [normalizedFolderId]: expanded,
            },
          };
        }),
    }),
    {
      name: GC_SIDEBAR_UI_STATE_STORAGE_KEY,
      partialize: (state) => ({ folderExpandedById: state.folderExpandedById }),
      storage: createJSONStorage(createGcSidebarUiStateStorage),
    },
  ),
);
