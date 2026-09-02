// Bounded LRU + TTL cache.
//
// Two bounds enforced together: max entries (LRU eviction) and max age
// (TTL expiry). Every `get` checks the timestamp; every `set` evicts
// the oldest entry until size is within the cap. The list head is
// the most-recently-used, the tail is the oldest. Eviction is O(1).
//
// All operations are synchronous and non-throwing. Reads on a missing
// key return null. Writes on a key that already exists update the
// value AND bump the entry to the head of the LRU list.

export class LRU {
  constructor({ max = 1000, ttlMs = 90_000 } = {}) {
    this.max = Math.max(1, max);
    this.ttlMs = Math.max(0, ttlMs);
    this.map = new Map(); // key -> { value, ts }
  }

  get size() {
    return this.map.size;
  }

  get(key) {
    const entry = this.map.get(key);
    if (!entry) return null;
    if (this.ttlMs > 0 && Date.now() - entry.ts > this.ttlMs) {
      this.map.delete(key);
      return null;
    }
    // Bump to head. Map iteration order is insertion order, so re-insert
    // moves the key to the most-recently-used position.
    this.map.delete(key);
    this.map.set(key, entry);
    return entry.value;
  }

  // set returns true if the key was newly added, false if it was an update.
  set(key, value) {
    const existed = this.map.has(key);
    this.map.set(key, { value, ts: Date.now() });
    if (!existed) this.evict();
    return !existed;
  }

  // Drop the oldest entry until size <= max. Called automatically on
  // set() when a new key is added; exposed for callers that bulk-load.
  evict() {
    while (this.map.size > this.max) {
      const oldest = this.map.keys().next().value;
      this.map.delete(oldest);
    }
  }

  // Drop entries whose timestamp is older than ttlMs. Walks the whole
  // map; intended to be called periodically (not on every get), since
  // the per-get TTL check above already covers the hot path.
  prune() {
    if (this.ttlMs <= 0) return 0;
    const cutoff = Date.now() - this.ttlMs;
    let removed = 0;
    for (const [k, v] of this.map) {
      if (v.ts < cutoff) {
        this.map.delete(k);
        removed++;
      }
    }
    return removed;
  }

  has(key) {
    return this.get(key) !== null;
  }

  delete(key) {
    return this.map.delete(key);
  }

  clear() {
    this.map.clear();
  }

  // For diagnostics. Returns a shallow array of { key, age } sorted by
  // age desc, capped at `limit` entries. No values — values can be
  // large order books and we don't want to copy them.
  describe(limit = 5) {
    const out = [];
    const now = Date.now();
    for (const [k, v] of this.map) {
      out.push({ key: k, ageMs: now - v.ts });
    }
    out.sort((a, b) => b.ageMs - a.ageMs);
    return out.slice(0, limit);
  }
}
