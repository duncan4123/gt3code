import type { OrchestrationSearchThreadMessagesResult } from "@t3tools/contracts";
import { queryOptions } from "@tanstack/react-query";

import { getPrimaryEnvironmentConnection } from "../environments/runtime";

export const orchestrationQueryKeys = {
  all: ["orchestration"] as const,
  searchThreadMessages: (query: string, limit: number) =>
    ["orchestration", "search-thread-messages", query, limit] as const,
};

const DEFAULT_THREAD_SEARCH_LIMIT = 50;
const DEFAULT_THREAD_SEARCH_STALE_TIME = 15_000;
const EMPTY_THREAD_SEARCH_RESULT: OrchestrationSearchThreadMessagesResult = {
  results: [],
};

export function orchestrationSearchThreadMessagesQueryOptions(input: {
  query: string | null;
  enabled?: boolean;
  limit?: number;
  staleTime?: number;
}) {
  const limit = input.limit ?? DEFAULT_THREAD_SEARCH_LIMIT;
  return queryOptions({
    queryKey: orchestrationQueryKeys.searchThreadMessages(input.query ?? "", limit),
    queryFn: async () => {
      if (!input.query) {
        throw new Error("Thread message search is unavailable.");
      }
      return getPrimaryEnvironmentConnection().client.orchestration.searchThreadMessages({
        query: input.query,
        limit,
      });
    },
    enabled: (input.enabled ?? true) && input.query !== null,
    staleTime: input.staleTime ?? DEFAULT_THREAD_SEARCH_STALE_TIME,
    placeholderData: (previous) => previous ?? EMPTY_THREAD_SEARCH_RESULT,
  });
}
