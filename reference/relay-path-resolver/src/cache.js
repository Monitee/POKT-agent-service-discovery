'use strict';

// Tiny TTL cache. The gateway index and supplier lists are stable across a block
// or two, so a short TTL turns repeated resolves in one agent session into a
// single chain scan. Probe results are intentionally NOT cached here — the
// resolver keeps those live (reachability is the thing most likely to change).

class TTLCache {
  /** @param {number} [defaultTtlMs=30000] */
  constructor(defaultTtlMs = 30_000) {
    this.defaultTtlMs = defaultTtlMs;
    this._store = new Map(); // key -> { value, expires }
  }

  get(key) {
    const hit = this._store.get(key);
    if (!hit) return undefined;
    if (hit.expires <= this._now()) {
      this._store.delete(key);
      return undefined;
    }
    return hit.value;
  }

  set(key, value, ttlMs = this.defaultTtlMs) {
    this._store.set(key, { value, expires: this._now() + ttlMs });
    return value;
  }

  /** Get-or-compute. The producer runs only on miss; its result is cached. */
  async wrap(key, producer, ttlMs = this.defaultTtlMs) {
    const cached = this.get(key);
    if (cached !== undefined) return cached;
    const value = await producer();
    return this.set(key, value, ttlMs);
  }

  clear() {
    this._store.clear();
  }

  // Date.now is isolated here so the one wall-clock dependency is easy to stub.
  _now() {
    return Date.now();
  }
}

module.exports = { TTLCache };
