import { describe, expect, it, vi, afterEach } from "vitest";

import { createResourceCache } from "./resourceCache.ts";

describe("createResourceCache", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns cached values within the TTL window", async () => {
    const cache = createResourceCache<string, number>({ ttlMs: 1_000 });
    let calls = 0;
    const loader = vi.fn(async () => ++calls);

    await expect(cache.get("bead", loader)).resolves.toBe(1);
    await expect(cache.get("bead", loader)).resolves.toBe(1);
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it("refreshes values after TTL expiration", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));

    const cache = createResourceCache<string, number>({ ttlMs: 3_000 });
    let calls = 0;
    const loader = vi.fn(async () => ++calls);

    await cache.get("convoy", loader);
    expect(loader).toHaveBeenCalledTimes(1);

    vi.setSystemTime(new Date("2026-01-01T00:00:02Z"));
    await cache.get("convoy", loader);
    expect(loader).toHaveBeenCalledTimes(1);

    vi.setSystemTime(new Date("2026-01-01T00:00:05Z"));
    await cache.get("convoy", loader);
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it("coalesces concurrent requests into a single loader call", async () => {
    const cache = createResourceCache<string, number>({ ttlMs: 1_000 });

    const deferred = (() => {
      let resolve!: (value: number) => void;
      const promise = new Promise<number>((res) => {
        resolve = res;
      });
      return { promise, resolve };
    })();
    const loader = vi.fn(() => deferred.promise);

    const promiseA = cache.get("formula", loader);
    const promiseB = cache.get("formula", loader);
    expect(loader).toHaveBeenCalledTimes(1);
    deferred.resolve(42);

    await expect(Promise.all([promiseA, promiseB])).resolves.toEqual([42, 42]);
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it("caches null results so missing resources are not re-fetched", async () => {
    const cache = createResourceCache<string, string | null>({ ttlMs: 5_000 });
    const loader = vi.fn(async () => null);

    await expect(cache.get("missing", loader)).resolves.toBeNull();
    await expect(cache.get("missing", loader)).resolves.toBeNull();
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it("supports explicit invalidation per key and for the whole cache", async () => {
    const cache = createResourceCache<string, number>({ ttlMs: 10_000 });
    let calls = 0;
    const loader = vi.fn(async () => ++calls);

    await cache.get("gc", loader);
    cache.invalidate("gc");
    await cache.get("gc", loader);

    expect(loader).toHaveBeenCalledTimes(2);

    cache.invalidate();
    expect(cache.size()).toBe(0);
  });

  it("evicts the oldest entries when exceeding maxEntries", async () => {
    const cache = createResourceCache<string, string>({
      ttlMs: 10_000,
      maxEntries: 2,
    });
    const loader = vi.fn(async (value: string) => value);

    await cache.get("a", () => loader("A"));
    await cache.get("b", () => loader("B"));
    await cache.get("c", () => loader("C"));

    expect(cache.size()).toBe(2);
    await cache.get("a", () => loader("A-new"));
    expect(loader).toHaveBeenCalledTimes(4);
  });
});
