// Live WebSocket order books (CCXT Pro methods are merged into CCXT v4).
// Keeps a bounded "hot set" of symbols streaming via watchOrderBook so the
// scanner can use fresher books than the periodic REST fetches provide.

const HOT_BASES_LIMIT = 40;          // max distinct tokens streamed per exchange
const CORE_EXCHANGES = new Set([     // reliable WS implementations, capped on purpose
  'binance', 'bybit', 'okx', 'kucoin', 'gate', 'mexc',
  'bitget', 'kraken', 'bitfinex', 'htx', 'cryptocom', 'phemex',
]);
const RESTART_DELAY_MS = 5000;
const ERROR_BACKOFF_MS = 15000;
const MAX_CONSECUTIVE_ERRORS = 5;

const MAJOR_BASES = ['BTC', 'ETH', 'SOL', 'XRP', 'BNB', 'DOGE', 'ADA', 'AVAX', 'LINK', 'TON'];

const state = new Map(); // exId -> { client, symbols, books, running, errors }
let hotBases = [...MAJOR_BASES];

export function liveStats() {
  let symbols = 0;
  let fresh = 0;
  const now = Date.now();
  for (const s of state.values()) {
    symbols += s.symbols.length;
    for (const b of s.books.values()) {
      if (now - b.timestamp < 45000) fresh++;
    }
  }
  return { watchedSymbols: symbols, freshBooks: fresh, hotBases: hotBases.length };
}

// Called by the engine after each scan with the bases currently worth
// streaming (opportunity tokens + majors). Bounded to keep WS load sane.
export function updateHotBases(opportunityBases) {
  const set = new Set(MAJOR_BASES);
  for (const b of opportunityBases || []) set.add(String(b).toUpperCase());
  hotBases = [...set].slice(0, HOT_BASES_LIMIT);
}

function symbolsFor(marketsByBase) {
  const out = [];
  for (const base of hotBases) {
    const m = marketsByBase.get(base);
    if (m) out.push({ base, symbol: m.symbol });
  }
  return out;
}

async function watchLoop(exId, client, entry, marketsByBase) {
  // Re-resolve symbols on each entry so newly-listed tokens get picked up
  // after a refresh; never let a hot reload leave a stale list.
  let syms = symbolsFor(marketsByBase);
  entry.symbols = syms.map((s) => s.symbol);
  if (!syms.length) return;
  let consecutiveErrors = 0;
  while (entry.running) {
    let progressed = false;
    for (const { base, symbol } of syms) {
      if (!entry.running) return;
      try {
        const book = await client.watchOrderBook(symbol, 10);
        entry.books.set(base, {
          bids: (book.bids || []).slice(0, 20),
          asks: (book.asks || []).slice(0, 20),
          timestamp: Date.now(),
        });
        consecutiveErrors = 0;
        progressed = true;
      } catch (e) {
        // Per-symbol errors do NOT count toward the global backoff — only a
        // run where NO symbol progressed does. This keeps a single bad pair
        // from disabling the watcher for the whole exchange.
        if (process.env.DEBUG_WS) console.warn(`[ws] ${exId} ${symbol}:`, e?.message);
      }
    }
    const allFailed = !progressed;
    if (allFailed) {
      consecutiveErrors++;
      if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
        console.warn(`[ws] ${exId}: ${consecutiveErrors} consecutive failed ticks, backing off`);
        await new Promise((r) => setTimeout(r, ERROR_BACKOFF_MS));
        consecutiveErrors = 0;
        // Refresh the symbol list — listings may have changed while offline.
        syms = symbolsFor(marketsByBase);
        entry.symbols = syms.map((s) => s.symbol);
      } else {
        await new Promise((r) => setTimeout(r, 1000));
      }
    }
  }
}

// Start/refresh watchers for the given scan participants.
export function ensureWatchers(scannedExchanges) {
  for (const ex of scannedExchanges) {
    if (!CORE_EXCHANGES.has(ex.id)) continue;
    if (typeof ex.client.watchOrderBook !== 'function') continue;
    if (!state.has(ex.id)) {
      const entry = { client: ex.client, symbols: [], books: new Map(), running: true };
      state.set(ex.id, entry);
      watchLoop(ex.id, ex.client, entry, ex.marketsByBase).catch(() => {});
    }
  }
}

// Stop everything (used when the process shuts down or lists shrink).
export function stopAll() {
  for (const entry of state.values()) entry.running = false;
  state.clear();
}

// Rebind market maps after each scan (symbols can change as listings change).
export function refreshSymbolMaps(markedExchanges) {
  for (const [exId, entry] of state) {
    const found = markedExchanges.find((e) => e.id === exId);
    if (found && found.marketsByBase) {
      const syms = symbolsFor(found.marketsByBase);
      entry.symbols = syms.map((s) => s.symbol);
    }
  }
}

// Returns a live book for exId/base if it exists and is fresh enough.
export function getLiveBook(exId, base) {
  const entry = state.get(exId);
  if (!entry) return null;
  const book = entry.books.get(base);
  if (!book || Date.now() - book.timestamp > 45000) return null;
  return book;
}
