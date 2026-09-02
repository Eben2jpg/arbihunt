// Legacy compatibility shim.
//
// The real WebSocket logic now lives inside each ExchangeAgent — see
// scanner/supervisor/ExchangeAgent.js. The supervisor's per-agent
// watch loop owns the WS lifecycle (start, stop, AbortController,
// backoff) so a failure on one venue cannot stop any other.
//
// This module is kept so the v1 fallback in engine.js still compiles
// and — if ever invoked — reads WS data from the same source as v2.
// Every function here delegates to the supervisor. The old in-memory
// `state` Map and the parallel watch loop have been deleted; the
// only WebSocket code path in the running process is the one inside
// the supervisor.

import { getSupervisor } from '../supervisor-bridge.js';

const FRESH_MS = 45_000;

function getAgentEntry(exId) {
  const sup = getSupervisor();
  if (!sup) return null;
  return sup.getAgent(exId) || null;
}

// startWatchers is now a no-op for callers — the supervisor manages
// its own watcher lifecycle. We keep the export so v1's call site
// continues to compile. If the supervisor isn't booted yet, this
// is a safe no-op.
export function ensureWatchers(_scannedExchanges) {
  const sup = getSupervisor();
  if (!sup) return;
  // Hot bases are kept in sync by the boot loop in index.js, so we
  // don't need to do anything here. The agents' WS loops run
  // independently and consult their own hot-bases list.
}

// refreshSymbolMaps is similarly a no-op — agents refresh their own
// symbol list when the supervisor calls updateHotBases.
export function refreshSymbolMaps(_markedExchanges) {
  // Intentionally empty.
}

// Per-cycle WS live book lookup. Delegates to the agent's liveBook
// map so there's exactly one source of truth.
export function getLiveBook(exId, base) {
  const agent = getAgentEntry(exId);
  if (!agent) return null;
  const book = agent.liveBook.get(String(base || '').toUpperCase());
  if (!book) return null;
  if (Date.now() - book.timestamp > FRESH_MS) return null;
  return book;
}

// Called by engine.js v1 at the end of each scan to feed the next
// cycle's hot-bases. Delegates to the supervisor.
export function updateHotBases(opportunityBases) {
  const sup = getSupervisor();
  if (!sup) return;
  const set = new Set(['BTC', 'ETH', 'SOL', 'XRP', 'BNB', 'DOGE', 'ADA', 'AVAX', 'LINK', 'TON']);
  for (const b of opportunityBases || []) {
    if (b) set.add(String(b).toUpperCase());
    if (set.size >= 40) break;
  }
  sup.updateHotBases([...set]);
}

// Stats for /api/ticker. Reads from the supervisor so the numbers
// stay consistent with what the agents actually have.
export function liveStats() {
  const sup = getSupervisor();
  if (!sup) return { watchedSymbols: 0, freshBooks: 0, hotBases: 0 };
  let watchedSymbols = 0;
  let freshBooks = 0;
  const now = Date.now();
  for (const agent of sup.agents.values()) {
    watchedSymbols += agent._wsHotBases.length;
    for (const b of agent.liveBook.values()) {
      if (now - b.timestamp < FRESH_MS) freshBooks++;
    }
  }
  return { watchedSymbols, freshBooks, hotBases: sup.hotBases.length };
}

// stopAll is called only on process exit. The supervisor's shutdown()
// does the real work; this is a compatibility no-op.
export function stopAll() {
  // Intentionally empty — supervisor.shutdown() is the single drain point.
}
