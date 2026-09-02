// One isolated exchange.
//
// Every external interaction with a crypto venue goes through an
// ExchangeAgent. The agent is the failure boundary: nothing it does
// ever throws to its caller. Every public method returns a result
// object of the shape
//
//   { ok: true,  value }
//   { ok: false, error, reason }
//
// so the supervisor and engine can branch on `ok` without try/catch.
//
// Per-agent state (own FSM, own timers, own caches, own circuit
// breaker). A bug, timeout, rate-limit, or total network failure on
// one exchange cannot affect any other agent.
//
// The agent does NOT know about arbitrage. It only knows:
//   - how to ask the venue for its market list
//   - how to ask the venue for an order book
//   - how to ask the venue for its withdrawal-fee table
//   - how to stream live books via WebSocket (if supported)
//   - how to report its own health

import { LRU } from '../cache/LRU.js';

export const AgentState = Object.freeze({
  INIT: 'INIT',               // constructed, never contacted
  CONNECTED: 'CONNECTED',     // last call succeeded
  DEGRADED: 'DEGRADED',       // some calls failing, some succeeding
  DISCONNECTED: 'DISCONNECTED', // last several calls failed
  RATE_LIMITED: 'RATE_LIMITED', // HTTP 429 (or exchange-equivalent)
  RECONNECTING: 'RECONNECTING', // backoff window between attempts
  UNSUPPORTED: 'UNSUPPORTED', // ccxt class missing or no client
  SHUTDOWN: 'SHUTDOWN',       // stop() was called
});

// Circuit-breaker thresholds. After this many consecutive failures
// the breaker opens and the agent enters DISCONNECTED (or
// RATE_LIMITED on 429). The breaker half-opens after backoffMs
// and lets one probe call through.
const CB_FAIL_THRESHOLD = 5;

// Backoff schedule. After the breaker opens we wait, then try one
// probe. The wait grows up to this cap, with ±20% jitter so 36
// agents don't all retry on the same tick.
const BACKOFF_INITIAL_MS = 1_000;
const BACKOFF_MAX_MS = 60_000;

// Per-call ceilings. Mirrors the values used by the old engine but
// lives here so each agent enforces its own budget independently.
const MARKETS_TIMEOUT_MS = 10_000;
const BOOK_TIMEOUT_MS = 6_000;
const FEES_TIMEOUT_MS = 8_000;

// Per-agent caches.
const BOOK_CACHE_MAX = 256;          // per-agent LRU book cache
const BOOK_CACHE_TTL_MS = 90_000;    // 90s, matches the old engine
const FEE_CACHE_TTL_MS = 30 * 60_000; // 30 minutes; fees are slow-moving
// Cap on per-agent WS liveBook Map. Each entry is a 20-level book
// (~5-10 KB) so 100 entries is ~1 MB per agent × 36 agents = 36 MB
// worst case. The Map evicts the oldest entry on every overflow
// write, so the working set stays bounded even with rapid WS frames.
const LIVE_BOOK_MAX = 100;

// Cap hot bases streamed per agent. Smaller than the old global cap
// because each agent is now its own budget.
const WS_HOT_BASES = 40;

// Coarse classification of a failure. The supervisor uses this to
// decide whether to mark the agent RATE_LIMITED vs DISCONNECTED.
function classifyError(err) {
  if (!err) return 'unknown';
  const msg = String(err.message || err);
  if (/429|rate.?limit|too many|throttle/i.test(msg)) return 'rate_limited';
  if (/timeout|ETIMEDOUT|ESOCKETTIMEDOUT|AbortError/i.test(msg)) return 'timeout';
  if (/ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|EHOSTUNREACH|ENETUNREACH|ENETDOWN|socket hang up/i.test(msg)) return 'network';
  if (/403|401|auth|api.?key|invalid.?key|signature/i.test(msg)) return 'auth';
  if (/5\d\d|server error|bad gateway|service unavailable/i.test(msg)) return 'server';
  return 'unknown';
}

function withTimeout(promise, ms, label) {
  let timer;
  const race = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timeout`)), ms);
  });
  return Promise.race([promise, race]).finally(() => clearTimeout(timer));
}

export class ExchangeAgent {
  constructor({ id, name, client, markets, taker, onStateChange }) {
    this.id = id;
    this.name = name || id;
    this.client = client || null;       // null => UNSUPPORTED
    this.staticMarkets = markets || null; // optional preloaded list
    this.staticTaker = taker != null ? taker : 0.001;
    this.onStateChange = onStateChange || (() => {});

    // FSM
    this.state = this.client ? AgentState.INIT : AgentState.UNSUPPORTED;
    this.stateReason = this.client ? 'booting' : 'no ccxt client';
    this.consecutiveFailures = 0;
    this.consecutiveSuccesses = 0;
    this.lastSuccessAt = 0;
    this.lastErrorAt = 0;
    this.lastError = null;
    this.lastErrorClass = null;
    this.backoffMs = 0;
    this.nextRetryAt = 0;
    this.lastLatencyMs = 0;

    // Per-agent data
    this.markets = [];                  // [{ symbol, base, quote, taker, limits, minAmount }]
    this.marketsByBase = new Map();
    this.bookCache = new LRU({ max: BOOK_CACHE_MAX, ttlMs: BOOK_CACHE_TTL_MS });
    this.feeCache = new Map();          // base -> { ts, networks: Map }
    this.liveBook = new Map();          // base -> { bids, asks, timestamp }
    this.supportedFeatures = {
      watchOrderBook: !!(this.client && typeof this.client.watchOrderBook === 'function'),
      fetchCurrencies: !!(this.client && typeof this.client.fetchCurrencies === 'function'),
    };

    // In-flight guard: at most one outstanding call per kind per
    // agent. Slow exchanges can't queue 400 calls.
    this._inFlight = { markets: false, book: false, fees: false, watch: false };

    // WS state
    this._wsAbort = null;
    this._wsTimer = null;
    this._wsRunning = false;
    this._wsHotBases = [];

    // Bookkeeping for the supervisor
    this._stopped = false;
    this._bootPromise = null;
  }

  // -------------------------------------------------------------------------
  // State transitions. Every transition is logged and (optionally) pushed
  // to a listener so the dashboard can show a live FSM.
  // -------------------------------------------------------------------------

  _transition(next, reason) {
    if (this._stopped && next !== AgentState.SHUTDOWN) return;
    if (this.state === next) return;
    const prev = this.state;
    this.state = next;
    this.stateReason = reason || '';
    // One-line structured log so it's easy to grep.
    console.log(`[agent:${this.id}] ${prev} -> ${next}${reason ? ` (${reason})` : ''}`);
    try { this.onStateChange(this, prev, next); } catch (_) {}
  }

  _recordSuccess(latencyMs) {
    this.consecutiveFailures = 0;
    this.consecutiveSuccesses++;
    this.lastSuccessAt = Date.now();
    this.lastLatencyMs = latencyMs;
    this.backoffMs = 0;
    this.nextRetryAt = 0;
  }

  _recordFailure(err) {
    this.consecutiveFailures++;
    this.lastErrorAt = Date.now();
    this.lastError = err?.message || String(err);
    this.lastErrorClass = classifyError(err);
  }

  _scheduleBackoff() {
    // Exponential with jitter, capped at BACKOFF_MAX_MS.
    const base = Math.min(BACKOFF_MAX_MS, BACKOFF_INITIAL_MS * Math.pow(2, Math.min(10, this.consecutiveFailures - 1)));
    const jitter = base * (0.8 + Math.random() * 0.4);
    this.backoffMs = Math.round(jitter);
    this.nextRetryAt = Date.now() + this.backoffMs;
  }

  // -------------------------------------------------------------------------
  // Boot. Loads markets, then schedules a fee refresh. Sequential within
  // this agent so we never open multiple TLS sessions to the same venue
  // in parallel.
  // -------------------------------------------------------------------------

  boot() {
    if (this._bootPromise) return this._bootPromise;
    this._bootPromise = (async () => {
      if (this.state === AgentState.UNSUPPORTED) return this.snapshot();
      // If a static market list was provided at construction time, use
      // it as the boot-time universe and only refresh later.
      if (this.staticMarkets && this.staticMarkets.length) {
        this._applyMarkets(this.staticMarkets);
      }
      const r = await this.loadMarketsSafe();
      if (r.ok) {
        this._transition(AgentState.CONNECTED, `loaded ${this.markets.length} USDT markets in ${r.latencyMs}ms`);
        // Kick off fees in the background — not required for first scan.
        this.refreshFeesSafe().catch(() => {});
      } else {
        this._transition(AgentState.DISCONNECTED, `loadMarkets failed: ${r.error}`);
      }
      return this.snapshot();
    })();
    return this._bootPromise;
  }

  // -------------------------------------------------------------------------
  // Public safe API. Every method returns { ok, value|error, ... }.
  // -------------------------------------------------------------------------

  async loadMarketsSafe() {
    if (this._stopped) return { ok: false, error: 'shutdown', reason: 'shutdown' };
    if (this.state === AgentState.UNSUPPORTED) return { ok: false, error: 'unsupported', reason: 'unsupported' };
    if (this._inFlight.markets) return { ok: false, error: 'in_flight', reason: 'busy' };
    if (this.nextRetryAt && Date.now() < this.nextRetryAt) {
      return { ok: false, error: 'backoff', reason: `next retry in ${this.nextRetryAt - Date.now()}ms` };
    }
    if (!this.client || typeof this.client.loadMarkets !== 'function') {
      this._transition(AgentState.UNSUPPORTED, 'no loadMarkets');
      return { ok: false, error: 'no_load_markets', reason: 'unsupported' };
    }
    this._inFlight.markets = true;
    const t0 = Date.now();
    try {
      const raw = await withTimeout(this.client.loadMarkets(), MARKETS_TIMEOUT_MS, 'loadMarkets');
      const usdt = Object.values(raw)
        .filter((m) => m && m.active !== false && /usdt$/i.test(m.symbol || ''))
        .map((m) => ({
          symbol: m.symbol,
          base: String(m.base || '').toUpperCase(),
          quote: 'USDT',
          taker: m.taker != null ? m.taker : this.staticTaker,
          limits: m.limits || {},
        }))
        .filter((m) => m.base && !/^USD|^USDC|^BUSD|^DAI|^TUSD|^FDUSD|^USDE$/.test(m.base));
      this._applyMarkets(usdt);
      this._recordSuccess(Date.now() - t0);
      // If we were in any failure state, promote to CONNECTED.
      if (this.state !== AgentState.CONNECTED) {
        this._transition(AgentState.CONNECTED, `markets refreshed: ${usdt.length}`);
      }
      return { ok: true, value: usdt, latencyMs: this.lastLatencyMs };
    } catch (e) {
      this._recordFailure(e);
      this._handleFailureAfterCall('loadMarkets');
      return { ok: false, error: this.lastError, reason: this.lastErrorClass };
    } finally {
      this._inFlight.markets = false;
    }
  }

  async fetchOrderBookSafe(symbol) {
    if (this._stopped) return { ok: false, error: 'shutdown' };
    if (!this.client || typeof this.client.fetchOrderBook !== 'function') {
      return { ok: false, error: 'no_fetch_order_book' };
    }
    if (this._inFlight.book) return { ok: false, error: 'in_flight' };
    if (this.nextRetryAt && Date.now() < this.nextRetryAt) {
      return { ok: false, error: 'backoff' };
    }
    this._inFlight.book = true;
    const t0 = Date.now();
    try {
      const book = await withTimeout(this.client.fetchOrderBook(symbol, 20), BOOK_TIMEOUT_MS, 'fetchOrderBook');
      if (!book || !book.bids || !book.asks || book.bids.length === 0 || book.asks.length === 0) {
        throw new Error('empty order book');
      }
      this.bookCache.set(symbol, book);
      this._recordSuccess(Date.now() - t0);
      // Soft success: even a flaky exchange that occasionally returns
      // valid books is still CONNECTED. We track DEGRADED based on
      // failure ratio, not absolute.
      this._maybePromoteAfterSuccess();
      return { ok: true, value: book, fromCache: false };
    } catch (e) {
      this._recordFailure(e);
      this._handleFailureAfterCall('fetchOrderBook');
      return { ok: false, error: this.lastError, reason: this.lastErrorClass };
    } finally {
      this._inFlight.book = false;
    }
  }

  // Read-through book access. The engine calls this in the hot path:
  // it always succeeds (returns whatever is in the LRU) and tags the
  // result with fromCache so the engine can be honest about freshness.
  getCachedBook(symbol) {
    const book = this.bookCache.get(symbol);
    if (!book) return null;
    return { book, fromCache: true, ageMs: Date.now() - this.bookCache.describe(0).find(() => true)?.ageMs };
  }

  async refreshFeesSafe() {
    if (this._stopped) return { ok: false };
    if (!this.supportedFeatures.fetchCurrencies) return { ok: false, error: 'unsupported' };
    if (this._inFlight.fees) return { ok: false, error: 'in_flight' };
    this._inFlight.fees = true;
    try {
      const raw = await withTimeout(this.client.fetchCurrencies(), FEES_TIMEOUT_MS, 'fetchCurrencies');
      this._ingestFees(raw);
      this._recordSuccess(0);
      this._maybePromoteAfterSuccess();
      return { ok: true, count: this.feeCache.size };
    } catch (e) {
      this._recordFailure(e);
      // Fee refresh failures are softer than market failures: an exchange
      // can still trade even if its currencies endpoint is down. So we
      // do NOT flip the FSM here, just record the error.
      return { ok: false, error: this.lastError };
    } finally {
      this._inFlight.fees = false;
    }
  }

  feeFor(base, chain) {
    const entry = this.feeCache.get(String(base || '').toUpperCase());
    if (!entry) return null;
    if (Date.now() - entry.ts > FEE_CACHE_TTL_MS) return null;
    if (chain && entry.networks.has(chain)) {
      const n = entry.networks.get(chain);
      if (n.fee != null) return { fee: n.fee, network: n.network, source: 'live' };
    }
    let best = null;
    for (const [k, v] of entry.networks) {
      if (v.fee == null) continue;
      if (!best || v.fee < best.fee) best = { k, ...v };
    }
    return best ? { fee: best.fee, network: best.network, source: 'live' } : null;
  }

  // -------------------------------------------------------------------------
  // WebSocket. Lives entirely inside the agent so a WS failure on one
  // venue cannot stop any other venue's watcher.
  // -------------------------------------------------------------------------

  startWatch(hotBases) {
    if (this._stopped) return;
    if (!this.supportedFeatures.watchOrderBook) return;
    this._wsHotBases = (hotBases || []).slice(0, WS_HOT_BASES);
    if (this._wsRunning) return;
    this._wsRunning = true;
    this._runWatchLoop().catch((e) => {
      this._wsRunning = false;
      this._recordFailure(e);
      this._handleFailureAfterCall('watchOrderBook');
    });
  }

  stopWatch() {
    this._wsRunning = false;
    if (this._wsAbort) {
      try { this._wsAbort.abort(); } catch (_) {}
      this._wsAbort = null;
    }
    if (this._wsTimer) {
      clearTimeout(this._wsTimer);
      this._wsTimer = null;
    }
  }

  updateHotBases(hotBases) {
    this._wsHotBases = (hotBases || []).slice(0, WS_HOT_BASES);
  }

  getLiveBook(base) {
    const b = this.liveBook.get(String(base || '').toUpperCase());
    if (!b) return null;
    if (Date.now() - b.timestamp > 45_000) return null;
    return b;
  }

  // Bounded write to liveBook. Drops the oldest entry when the cap
  // is exceeded so the working set stays bounded under high WS
  // frame rates. Without this cap, 40 hot bases streaming 5 frames/s
  // accumulates thousands of entries over 30 minutes and OOMs the
  // process when combined with the other per-agent state.
  _setLiveBook(base, value) {
    if (this.liveBook.size >= LIVE_BOOK_MAX && !this.liveBook.has(base)) {
      // Drop the oldest entry. Map iteration order is insertion
      // order, so the first key is the oldest.
      const oldest = this.liveBook.keys().next().value;
      if (oldest !== undefined) this.liveBook.delete(oldest);
    }
    this.liveBook.set(base, value);
  }

  async _runWatchLoop() {
    while (this._wsRunning && !this._stopped) {
      this._wsAbort = new AbortController();
      let progressed = false;
      for (const base of this._wsHotBases) {
        if (!this._wsRunning) return;
        const sym = this.marketsByBase.get(base)?.symbol;
        if (!sym) continue;
        try {
          const book = await withTimeout(
            this.client.watchOrderBook(sym, 10),
            BOOK_TIMEOUT_MS,
            'watchOrderBook'
          );
          if (book && book.bids && book.asks) {
            this._setLiveBook(base, {
              bids: book.bids.slice(0, 20),
              asks: book.asks.slice(0, 20),
              timestamp: Date.now(),
            });
            progressed = true;
            this._recordSuccess(0);
            this._maybePromoteAfterSuccess();
          }
        } catch (_) {
          // Per-symbol failures are tolerated; we only count a full
          // pass with no progress as a WS failure.
        }
        if (this._wsAbort.signal.aborted) return;
      }
      if (!progressed) {
        this._recordFailure(new Error('ws_no_progress'));
        this._handleFailureAfterCall('watchOrderBook');
        // Backoff before next attempt; the loop will be re-entered
        // by startWatch() once the agent recovers.
        await new Promise((r) => {
          this._wsTimer = setTimeout(r, this.backoffMs || 1000);
        });
        if (!this._wsRunning) return;
        // Re-evaluate state after backoff.
        if (this.state === AgentState.CONNECTED || this.state === AgentState.DEGRADED) {
          // Try again next tick.
        } else {
          // Stay parked until the supervisor re-promotes us.
          await new Promise((r) => { this._wsTimer = setTimeout(r, 5000); });
        }
      } else {
        // Small pacing delay between successful loops.
        await new Promise((r) => { this._wsTimer = setTimeout(r, 250); });
      }
    }
  }

  // -------------------------------------------------------------------------
  // Health snapshot for the dashboard.
  // -------------------------------------------------------------------------

  snapshot() {
    return {
      id: this.id,
      name: this.name,
      state: this.state,
      reason: this.stateReason,
      consecutiveFailures: this.consecutiveFailures,
      consecutiveSuccesses: this.consecutiveSuccesses,
      lastSuccessAt: this.lastSuccessAt,
      lastErrorAt: this.lastErrorAt,
      lastError: this.lastError,
      lastErrorClass: this.lastErrorClass,
      lastLatencyMs: this.lastLatencyMs,
      backoffMs: this.backoffMs,
      nextRetryAt: this.nextRetryAt,
      markets: this.markets.length,
      bases: this.marketsByBase.size,
      bookCacheSize: this.bookCache.size,
      liveBookSize: this.liveBook.size,
      supportedFeatures: this.supportedFeatures,
    };
  }

  // -------------------------------------------------------------------------
  // Lifecycle.
  // -------------------------------------------------------------------------

  stop() {
    this._stopped = true;
    this.stopWatch();
    this.bookCache.clear();
    this.feeCache.clear();
    this.liveBook.clear();
    this._transition(AgentState.SHUTDOWN, 'stopped');
  }

  // -------------------------------------------------------------------------
  // Internals.
  // -------------------------------------------------------------------------

  _applyMarkets(list) {
    this.markets = list;
    this.marketsByBase = new Map();
    for (const m of list) {
      if (!this.marketsByBase.has(m.base)) this.marketsByBase.set(m.base, m);
    }
  }

  _ingestFees(currencies) {
    if (!currencies || typeof currencies !== 'object') return;
    const ts = Date.now();
    for (const [coinCode, entry] of Object.entries(currencies)) {
      if (!entry || typeof entry !== 'object') continue;
      const upper = String(coinCode).toUpperCase();
      const nets = entry.networks || {};
      const netMap = new Map();
      for (const [k, v] of Object.entries(nets)) {
        if (!v || typeof v !== 'object') continue;
        if (v.withdraw === false) continue;
        const fee = v.fee != null && Number.isFinite(Number(v.fee)) ? Number(v.fee) : null;
        netMap.set(k, {
          fee,
          network: v.network || k,
          withdraw: v.withdraw !== false,
          deposit: v.deposit !== false,
        });
      }
      if (netMap.size > 0) this.feeCache.set(upper, { ts, networks: netMap });
    }
  }

  _handleFailureAfterCall(label) {
    // Auth failures are permanent — the operator must fix the key.
    if (this.lastErrorClass === 'auth') {
      this._transition(AgentState.DISCONNECTED, `auth error in ${label}: ${this.lastError}`);
      return;
    }
    if (this.lastErrorClass === 'rate_limited') {
      this._transition(AgentState.RATE_LIMITED, `${label} 429: ${this.lastError}`);
      this._scheduleBackoff();
      return;
    }
    if (this.consecutiveFailures >= CB_FAIL_THRESHOLD) {
      this._transition(AgentState.DISCONNECTED, `${label} failed ${this.consecutiveFailures}x: ${this.lastError}`);
      this._scheduleBackoff();
      return;
    }
    // Below the threshold — soft degrade, don't broadcast.
    if (this.state === AgentState.CONNECTED && this.consecutiveFailures >= 2) {
      this._transition(AgentState.DEGRADED, `${label} failing (${this.consecutiveFailures}/${CB_FAIL_THRESHOLD})`);
    }
  }

  _maybePromoteAfterSuccess() {
    if (this.state === AgentState.DEGRADED && this.consecutiveSuccesses >= 3) {
      this._transition(AgentState.CONNECTED, 'recovered');
    } else if (this.state === AgentState.RECONNECTING) {
      this._transition(AgentState.CONNECTED, 'probe succeeded');
    } else if (this.state === AgentState.INIT) {
      this._transition(AgentState.CONNECTED, 'first success');
    } else if (this.state === AgentState.RATE_LIMITED) {
      this._transition(AgentState.DEGRADED, 'recovered from 429');
    } else if (this.state === AgentState.DISCONNECTED) {
      this._transition(AgentState.DEGRADED, 'probe succeeded');
    }
  }
}
