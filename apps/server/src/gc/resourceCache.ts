/**
 * Lightweight TTL cache with in-flight request coalescing.
 *
 * Used by the GC integration to avoid hammering the GC API when
 * multiple threads request the same bead/convoy/formula in quick
 * succession. The cache stores null values as well so we don't
 * keep re-requesting missing resources.
 */

export interface ResourceCacheOptions {
  /** Duration to cache an entry, in milliseconds. */
  readonly ttlMs: number;
  /** Max number of cached entries before evicting the oldest. */
  readonly maxEntries?: number;
}

interface CacheEntry<V> {
  readonly value: V;
  readonly expiresAt: number;
}

export interface ResourceCache<K, V> {
  /**
   * Fetch a value for the given key using `loader` when the cache
   * is empty or expired. Concurrent requests share the same loader
   * promise so the resource is fetched only once.
   */
  readonly get: (key: K, loader: () => Promise<V>) => Promise<V>;
  /** Remove a single key (or everything if omitted). */
  readonly invalidate: (key?: K) => void;
  /** Current number of cached entries (mostly for tests/observability). */
  readonly size: () => number;
}

export function createResourceCache<K, V>(options: ResourceCacheOptions): ResourceCache<K, V> {
  const ttlMs = Math.max(0, options.ttlMs);
  const maxEntries = options.maxEntries ?? 256;
  const store = new Map<K, CacheEntry<V>>();
  const inflight = new Map<K, Promise<V>>();

  const cleanupExpired = (now: number) => {
    for (const [key, entry] of store) {
      if (entry.expiresAt <= now) {
        store.delete(key);
      }
    }
  };

  const enforceSizeLimit = () => {
    while (store.size > maxEntries) {
      const oldestKey = store.keys().next().value as K | undefined;
      if (oldestKey === undefined) break;
      store.delete(oldestKey);
    }
  };

  const get: ResourceCache<K, V>["get"] = async (key, loader) => {
    const now = Date.now();
    const entry = store.get(key);
    if (entry && entry.expiresAt > now) {
      return entry.value;
    }

    if (entry) {
      store.delete(key);
    }

    const existing = inflight.get(key);
    if (existing) {
      return existing;
    }

    const promise = loader().finally(() => {
      inflight.delete(key);
    });
    inflight.set(key, promise);

    try {
      const value = await promise;
      if (ttlMs > 0) {
        store.set(key, { value, expiresAt: Date.now() + ttlMs });
        cleanupExpired(Date.now());
        enforceSizeLimit();
      }
      return value;
    } catch (error) {
      store.delete(key);
      throw error;
    }
  };

  const invalidate: ResourceCache<K, V>["invalidate"] = (key) => {
    if (key === undefined) {
      store.clear();
      inflight.clear();
      return;
    }
    store.delete(key);
    inflight.delete(key);
  };

  return {
    get,
    invalidate,
    size: () => store.size,
  } satisfies ResourceCache<K, V>;
}
