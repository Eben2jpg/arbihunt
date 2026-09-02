import { exchanges, liveExchanges } from './exchanges.js';
import { loadMarkets, cacheMarkets, getCachedMarkets, buildUniverse } from './markets.js';
import { orderBookToSide, fillPrice, evaluateRoute } from './arbitrage.js';
import { enrichVolumes } from './volumes.js';
import { addScanHistory, isPro } from '../db.js';
import { FREE_MAX_SPREAD_PERCENT } from '../constants.js';
import { ensureWatchers, refreshSymbolMaps, getLiveBook, updateHotBases, liveStats } from './liveBooks.js';
import { routeIsOpen } from './liveFees.js';
import { getSupervisor } from '../supervisor-bridge.js';
import { AgentState } from './supervisor/ExchangeAgent.js';

// Smaller trade size lets the scanner include lower-priced / thinner tokens
// that still have real, tradeable liquidity.
const TRADE_SIZE_BASE = 20;
const MIN_LIQUIDITY_USD = 5; // flag out tokens with less than $5 executable liquidity
// Residential IP reachability varies wildly. Give each call a generous
// ceiling so a slow-but-reachable exchange still contributes books this
// cycle instead of being silently dropped. The 25s scan interval caps the
// overall cost of any one venue regardless of these per-call windows.
const ORDER_BOOK_TIMEOUT_MS = 6000;
const MARKETS_TIMEOUT_MS = 10000; // markets.js has its own ceiling; this is the
                                  // outer race so a single slow exchange can
                                  // never stretch the whole cycle.
const FETCH_CONCURRENCY = 32;
// Cap each exchange to the top N bases per cycle. Beyond this the books
// become progressively thinner and the per-symbol cost is dominated by
// timeouts anyway; this keeps the cycle bounded.
const MAX_BOOKS_PER_EXCHANGE = 400;
// V2 ceilings: bound the total per-cycle work so a degraded network
// can't stack up an unbounded queue.
const MAX_BASES_PER_CYCLE = 1500;       // cap the token universe size
const MAX_BOOK_FETCHES_PER_CYCLE = 6000; // cap the (base × agent) pairs
// Only tokens listed on >= 2 exchanges can ever produce a cross-exchange
// signal. With Render's 512 MB container we can't fan out the full ~6,632
// token universe across 36 exchanges per cycle; the >1 listing filter
// drops it to a few hundred cross-listed tokens that are the actual
// source of every real opportunity. Free-tier hosts in particular OOM
// the process before the cycle finishes at the full universe.
const MIN_LISTINGS = 2;
const PROBE_SYMBOLS = 3;
// Leveraged tokens ("BTC3L", "ETH3S", ...) exist per-exchange and track that
// venue's own underlying index — they are NOT the same asset across exchanges
// and cannot be arbitraged by transferring. Exclude them.
const LEVERAGED_BASE_RE = /(\d+[LS]|BULL|BEAR)$/i;
// Anything claiming > this % net profit is almost certainly a stale price,
// delisted market or mismatched asset, not a tradeable opportunity.
const MAX_PLAUSIBLE_NET_PCT = 25;
// Professional floor: show every opportunity at/above 0.10% net so users
// see the full action set, even when the count climbs past 100. Below
// 0.10% the signal is dominated by slippage and is not actionable.
const MIN_NET_PROFIT_PCT = 0.10;

let latestOpportunities = [];
let scansDone = 0;
let lastScanAt = 0;
let lastTokenCount = 0;
let lastDurationMs = 0;
let lastExchanges = 0;
let lastScannedExchanges = [];
let scanning = false;

// Cross-cycle book cache (LEGACY v1 only). In v2 each ExchangeAgent
// owns its own bounded LRU. We keep this map here so the v1 fallback
// path still compiles, but we now back it with the LRU class so a
// process that runs v1 for an extended period cannot OOM.
import { LRU } from './cache/LRU.js';
const BOOK_CACHE_TTL_MS = 90_000;
const bookCache = new LRU({ max: 5000, ttlMs: BOOK_CACHE_TTL_MS }); // key: `${exId}:${base}` -> { book, taker, symbol }
function cacheKey(exId, base) { return `${exId}:${base}`; }

// Run `worker(item)` over `arr` with a bounded number of concurrent calls.
// This keeps the scanner fast while respecting exchange rate limits.
async function runPool(arr, worker) {
  const results = new Array(arr.length).fill(null);
  let next = 0;
  const work = async () => {
    while (next < arr.length) {
      const idx = next++;
      results[idx] = await worker(arr[idx], idx);
    }
  };
  const count = Math.max(1, Math.min(FETCH_CONCURRENCY, arr.length));
  await Promise.all(Array.from({ length: count }, () => work()));
  return results;
}

export function getLatestOpportunities() {
  return latestOpportunities;
}

async function fetchOrderBook(exchange, symbol) {
  try {
    const book = await Promise.race([
      exchange.fetchOrderBook(symbol, 20),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ORDER_BOOK_TIMEOUT_MS)),
    ]);
    return book;
  } catch (_e) {
    return null;
  }
}

// Cached fetch: try live, fall back to the last-good book from this
// exchange (within BOOK_CACHE_TTL_MS). Returns { book, fromCache, taker,
// symbol } so the caller can tag the row honestly.
async function fetchOrderBookCached(exchangeId, ex, t) {
  const live = getLiveBook(exchangeId, t.base);
  if (live && live.bids?.length && live.asks?.length) {
    return { base: t.base, symbol: t.symbol, book: live, taker: t.taker, fromCache: false };
  }
  const book = await fetchOrderBook(ex.client, t.symbol);
  if (book) {
    // LRU manages the timestamp internally; the value is just {book, taker, symbol}.
    bookCache.set(cacheKey(exchangeId, t.base), { book, taker: t.taker, symbol: t.symbol });
    return { base: t.base, symbol: t.symbol, book, taker: t.taker, fromCache: false };
  }
  // LRU.get() returns null if the entry is past TTL — no need to recheck here.
  const cached = bookCache.get(cacheKey(exchangeId, t.base));
  if (cached) {
    return { base: t.base, symbol: cached.symbol, book: cached.book, taker: cached.taker, fromCache: true };
  }
  return null;
}

export function detectOpportunities(booksByExchange, options = {}) {
  const { selectedExchanges, maxPerToken = 3 } = options;
  const opportunities = [];
  const byBase = new Map();

  for (const [exId, books] of Object.entries(booksByExchange)) {
    for (const { symbol, base, book, taker, minAmount } of books) {
      if (!book) continue;
      // Leveraged / inverse tokens are venue-specific products, not
      // transferable assets — skip before any pricing work.
      if (LEVERAGED_BASE_RE.test(base)) continue;
      if (!byBase.has(base)) byBase.set(base, []);
      byBase.get(base).push({ exId, symbol, book, taker, minAmount: minAmount });
    }
  }

  for (const [base, entries] of byBase) {
    const bids = [];
    const asks = [];
    for (const ent of entries) {
      const bidLevels = orderBookToSide(ent.book, 'bids');
      const askLevels = orderBookToSide(ent.book, 'asks');
      if (!bidLevels.length || !askLevels.length) continue;
      const bestBid = bidLevels[0].price;
      const bestAsk = askLevels[0].price;
      if (bestBid == null || bestAsk == null) continue;
      bids.push({ exId: ent.exId, price: bestBid, levels: bidLevels, symbol: ent.symbol, taker: ent.taker });
      asks.push({ exId: ent.exId, price: bestAsk, levels: askLevels, symbol: ent.symbol, taker: ent.taker });
    }

    for (const a of asks) {
      for (const b of bids) {
        if (a.exId === b.exId) continue;
        const grossSpreadPct = ((b.price - a.price) / a.price) * 100;
        if (grossSpreadPct <= 0) continue;

        // Size ladder: find the largest trade size BOTH order books can
        // actually absorb. This is the size a real trader could execute.
        let sizeBase = 0;
        for (const target of [20, 100, 500]) {
          const bd = fillPrice(a.levels, target);
          const sd = fillPrice(b.levels, target);
          if (!bd || !sd) break; // deeper size not available — keep last good
          sizeBase = Math.min(target, Math.min(bd.amount, sd.amount));
        }
        if (sizeBase <= 0) continue;

        // Venue min-order-size enforcement — an order below an exchange's
        // minimum can never actually be placed, so it is not tradable.
        const minAmt = Math.max(a.minAmount || 0, b.minAmount || 0);
        if (minAmt > 0 && sizeBase < minAmt) continue;

        // Matched-size repricing: both legs are priced at the EXACT same fill
        // size, so the profit number reflects one real, executable trade.
        const buyAt = fillPrice(a.levels, sizeBase);
        const sellAt = fillPrice(b.levels, sizeBase);
        if (!buyAt || !sellAt) continue;
        const avgAsk = buyAt.price;
        const avgBid = sellAt.price;
        const liquidityUsd = sizeBase * avgAsk;
        // Per-leg USD value: the actual fill size on each side, priced at
        // that side's average. Lets the dashboard show real depth on each
        // exchange independently instead of collapsing to the smaller side.
        const buyLiquidityUsd = sizeBase * avgAsk;
        const sellLiquidityUsd = sizeBase * avgBid;
        // Flag out anything below $20 of real executable liquidity.
        if (liquidityUsd < MIN_LIQUIDITY_USD) continue;

        const buyTakerFee = a.taker || 0.001;
        const sellTakerFee = b.taker || 0.001;

        const route = evaluateRoute({
          base,
          buyAsk: avgAsk,
          buyTakerFee,
          sellBid: avgBid,
          sellTakerFee,
          sizeBase,
          buyExchangeId: a.exId,
          sellExchangeId: b.exId,
        });

        if (!route) continue;
        // Flag out anything below the professional 0.10% net floor.
        if (route.netProfitPct < MIN_NET_PROFIT_PCT) continue;
        // Absurd "profits" mean stale prices / mismatched assets, not trades.
        if (route.netProfitPct > MAX_PLAUSIBLE_NET_PCT) continue;
        // Suspended-coin / suspended-chain filter. If we KNOW the chosen
        // chain is closed for deposits on the buy leg or withdrawals on the
        // sell leg, the trade cannot be executed — drop the row. If we
        // have no live info, the curated fee path remains in scope.
        if (route.network) {
          const open = routeIsOpen({
            base,
            chain: route.network,
            buyExchangeId: a.exId,
            sellExchangeId: b.exId,
          });
          if (open === false) continue;
        }

        opportunities.push({
          id: `${a.exId}-${b.exId}-${base}-${Date.now()}`,
          base,
          symbol: `${base}/USDT`,
          buyExchange: a.exId,
          sellExchange: b.exId,
          buySymbol: a.symbol,
          sellSymbol: b.symbol,
          buyPrice: avgAsk,
          sellPrice: avgBid,
          network: route.network,
          networkLabel: route.networkLabel,
          networkAssumed: !!route.networkAssumed,
          // 'live' = exchange's own fetchCurrencies API answered,
          // 'curated' = static fees.js table, 'estimated' = proportional fallback.
          feeSource: route.feeSource || 'estimated',
          // Real on-chain contract address when the live cache supplied one.
          contractAddress: route.contractAddress || null,
          withdrawFee: route.withdrawFee,
          signedNetwork: route.network,
          grossSpreadPct,
          netProfitPct: route.netProfitPct,
          netProfitUsdt: route.netProfitUsdt,
          sizeBase,
          liquidityUsd,
          buyLiquidityUsd,
          sellLiquidityUsd,
          timestamp: Date.now(),
        });
      }
    }
  }

  // Deduplicate: keep only top N per token by liquidity then profit.
  const grouped = new Map();
  for (const op of opportunities) {
    if (!grouped.has(op.base)) grouped.set(op.base, []);
    grouped.get(op.base).push(op);
  }
  const deduped = [];
  for (const [, ops] of grouped) {
    ops.sort((x, y) => y.liquidityUsd - x.liquidityUsd || y.netProfitPct - x.netProfitPct);
    deduped.push(...ops.slice(0, maxPerToken));
  }
  deduped.sort((x, y) => y.netProfitPct - x.netProfitPct || y.liquidityUsd - x.liquidityUsd);
  // Rank #1 = highest net percentage. The UI displays this order top to bottom.
  deduped.forEach((op, i) => { op.rank = i + 1; });

  if (selectedExchanges && selectedExchanges.length > 0) {
    const set = new Set(selectedExchanges);
    // Strict: keep only opportunities where BOTH legs are inside the
    // selected set. One-leg matches are also dropped so the user never
    // sees a row that bridges their selected 4 with an outside venue.
    return deduped.filter((op) => set.has(op.buyExchange) && set.has(op.sellExchange));
  }
  return deduped;
}

export async function runScan(config, options = {}) {
  // Never overlap scans: if the previous scan is still running (large universe
  // can exceed scanIntervalMs) skip this tick instead of stacking work.
  if (scanning) {
    console.log('[scan] still running, tick skipped');
    return { skipped: true };
  }
  scanning = true;

  const start = Date.now();
  try {
    // Strict per-exchange filter: when the caller pins a set, the scan
    // ONLY fetches order books from those venues. Anything outside the
    // set is excluded upstream of detection, so the result can never
    // contain a row that bridges the chosen set with a venue the user
    // did not pick.
    const selectedSet = (options.selectedExchanges && options.selectedExchanges.length)
      ? new Set(options.selectedExchanges)
      : null;
    const scanExchanges = selectedSet
      ? liveExchanges.filter((e) => selectedSet.has(e.id))
      : liveExchanges;
    if (selectedSet) console.log(`[scan] user-selected subset: ${scanExchanges.length} exchanges`);

    const marketsByExchange = {};
    const loadTasks = scanExchanges.map(async (ex) => {
      // Try live first (cached mark list might be stale), but always fall
      // back to the on-disk cache if the live call returns nothing or
      // times out. This is what keeps a network-restricted host scanning
      // the full universe from the last good state.
      const cached = (await getCachedMarkets(ex.id)) || [];
      let markets = null;
      try {
        const live = await Promise.race([
          loadMarkets(ex.client),
          new Promise((_, reject) => setTimeout(() => reject(new Error('markets timeout')), MARKETS_TIMEOUT_MS)),
        ]);
        if (Array.isArray(live) && live.length > 0) {
          markets = live;
          await cacheMarkets(ex.id, live);
        } else {
          markets = cached;
          if (cached.length) console.log(`[markets] ${ex.id}: live empty, using cache (${cached.length})`);
        }
      } catch (_) {
        markets = cached;
        if (cached.length) console.log(`[markets] ${ex.id}: live timeout, using cache (${cached.length})`);
      }
      if (!markets || markets.length === 0) return;
      marketsByExchange[ex.id] = markets;
    });
    await Promise.all(loadTasks);

    // Per-exchange base->market maps, shared by REST fetch tasks and WS watchers.
    const baseMaps = {};
    for (const [exId, list] of Object.entries(marketsByExchange)) {
      const byBase = new Map();
      for (const m of list) if (!byBase.has(m.base)) byBase.set(m.base, m);
      baseMaps[exId] = byBase;
    }
    // Start/refresh live WebSocket watchers for the exchanges being scanned.
    ensureWatchers(
      exchanges
        .filter((e) => baseMaps[e.id])
        .map((e) => ({ id: e.id, client: e.client, marketsByBase: baseMaps[e.id] }))
    );
    refreshSymbolMaps(
      Object.entries(baseMaps).map(([exId, m]) => ({ id: exId, marketsByBase: m }))
    );

    // Universe = union of every USDT base actually listed across exchanges.
    // 100% dynamic — no hardcoded token lists anywhere. If no exchange is
    // reachable this cycle there is simply nothing real to scan.
    const baseSet = new Set();
    for (const list of Object.values(marketsByExchange)) {
      for (const m of list) baseSet.add(m.base);
    }
    let universe = buildUniverse(baseSet);
    if (!universe.length) {
      console.log('[scan] no live markets available this cycle — skipping');
      scansDone++;
      lastScanAt = Date.now();
      latestOpportunities = [];
      lastTokenCount = 0;
      return { opportunities: [], durationMs: Date.now() - start, exchanges: 0, tokens: 0 };
    }

    // Only tokens listed on 2+ exchanges can ever produce a cross-exchange
    // arbitrage signal. Filtering the rest slashes scan time while keeping
    // every tradeable pair in the comparison.
    const listingCount = new Map();
    for (const list of Object.values(marketsByExchange)) {
      for (const m of list) listingCount.set(m.base, (listingCount.get(m.base) || 0) + 1);
    }
    const before = universe.length;
    universe = universe.filter((b) => (listingCount.get(b) || 0) >= MIN_LISTINGS);
    console.log(`[scan] universe filtered ${before} -> ${universe.length} (listed on >=${MIN_LISTINGS} exchanges)`);

    lastTokenCount = universe.length;
    console.log(`[scan] universe=${universe.length} tokens across ${Object.keys(marketsByExchange).length} exchanges`);

    const booksByExchange = {};
    const scanTasks = scanExchanges.map(async (ex) => {
      const markets = marketsByExchange[ex.id];
      if (!markets || !markets.length) return;
      const byBase = new Map();
      for (const m of markets) if (!byBase.has(m.base)) byBase.set(m.base, m);

      const tasks = [];
      for (const base of universe) {
        const m = byBase.get(base);
        if (m) tasks.push({ base, symbol: m.symbol, taker: m.taker, minAmount: m.limits?.amount?.min || 0 });
      }
      // Cap the work per exchange per cycle. The hottest opportunities
      // cluster around the most-traded bases, so scanning 600 vs 6000 gives
      // nearly the same signal at a fraction of the cost.
      if (tasks.length > MAX_BOOKS_PER_EXCHANGE) {
        tasks.length = MAX_BOOKS_PER_EXCHANGE;
      }

      // Two-stage probe: cheap 2s probe for the obvious "this exchange
      // is dead" case, then a generous 5s probe for the "this exchange
      // is just slow" case. Slow-but-reachable venues would have been
      // dropped by the cheap probe and zero-out their cross-listing
      // intersection. The 5s probe rescues them so a single 25s cycle
      // can still see 20+ venues even from a residential IP.
      let probeOk = true;
      if (tasks.length) {
        const fastProbe = await runPool(tasks.slice(0, PROBE_SYMBOLS), async (t) => {
          try {
            const book = await Promise.race([
              ex.client.fetchOrderBook(t.symbol, 5),
              new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 2000)),
            ]);
            return !!book && book.bids?.length > 0;
          } catch (_) { return false; }
        });
        probeOk = fastProbe.some(Boolean);
        if (!probeOk) {
          const slowProbe = await runPool(tasks.slice(0, 5), async (t) => {
            try {
              const book = await Promise.race([
                ex.client.fetchOrderBook(t.symbol, 5),
                new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 5000)),
              ]);
              return !!book && book.bids?.length > 0;
            } catch (_) { return false; }
          });
          probeOk = slowProbe.some(Boolean);
          if (probeOk) console.log(`[scan] ${ex.id}: rescued by slow probe`);
        }
      }
      if (!probeOk) {
        // No live REST this cycle. Mix WS books with the last-good cache so
        // the cross-listing intersection can still find pairs the other
        // venue was selling cheap. Tag them as fromCache so downstream
        // stats are honest.
        const wsBooks = tasks
          .map((t) => {
            const live = getLiveBook(ex.id, t.base);
            if (live) return { base: t.base, symbol: t.symbol, book: live, taker: t.taker, fromCache: false };
            const cached = bookCache.get(cacheKey(ex.id, t.base));
            if (cached) {
              return { base: t.base, symbol: cached.symbol, book: cached.book, taker: cached.taker, fromCache: true };
            }
            return null;
          })
          .filter(Boolean);
        if (wsBooks.length) booksByExchange[ex.id] = wsBooks;
        return;
      }

      const results = await runPool(tasks, async (t) => {
        return fetchOrderBookCached(ex.id, ex, t);
      });
      // Keep at least the symbols the WS was able to fill in even if all
      // REST fetches failed this cycle.
      const filled = results.filter(Boolean);
      if (filled.length) booksByExchange[ex.id] = filled;
    });
    await Promise.all(scanTasks);

    const detected = detectOpportunities(booksByExchange, options).slice(0, config.maxOpportunities);
    // Attach real 24h traded volume for the currently-live opportunity set.
    const exchangeMap = {};
    for (const ex of liveExchanges) if (ex.client) exchangeMap[ex.id] = { client: ex.client };
    let result = await enrichVolumes(detected, exchangeMap);

    latestOpportunities = result;
    scansDone++;
    lastScanAt = Date.now();
    // Stream the tokens that currently have signals (plus majors) via WS.
    updateHotBases(latestOpportunities.map((o) => o.base));
    const durationMs = Date.now() - start;
    lastDurationMs = durationMs;
    lastExchanges = Object.keys(booksByExchange).length;
    lastScannedExchanges = Object.keys(booksByExchange);

    addScanHistory(latestOpportunities.length, durationMs, Object.keys(booksByExchange).length).catch((e) => console.warn('[scan] addScanHistory failed:', e?.message || e));
    console.log(`[scan] ${latestOpportunities.length} opps from ${universe.length} tokens in ${durationMs}ms`);
    return { opportunities: latestOpportunities, durationMs, exchanges: Object.keys(booksByExchange).length, tokens: universe.length };
  } finally {
    scanning = false;
  }
}

// Supervisor-driven scan. Reads ALL data (markets, books, WS live)
// from the ExchangeSupervisor — no direct ccxt calls, no shared
// Promise.all over exchange arrays. A failure on one agent cannot
// affect the cycle: the agent itself catches and isolates.
//
// Per-agent work is parallelised via Promise.allSettled over a
// list of agent-only tasks, so the cycle wall-clock is bounded by
// the SLOWEST healthy agent, not the sum of all agents.
export async function runScanV2(config, options = {}) {
  if (scanning) {
    console.log('[scan] still running, tick skipped');
    return { skipped: true };
  }
  scanning = true;
  const start = Date.now();

  try {
    const supervisor = getSupervisor();
    if (!supervisor) {
      console.log('[scan:v2] supervisor not ready, falling back to v1');
      return await runScan(config, options);
    }

    // 1. Universe from the supervisor's healthy agents only. A dead
    //    exchange's tokens are simply not in the universe this cycle.
    const allMarkets = supervisor.getMarketsSnapshot();
    const baseSet = new Set();
    for (const m of allMarkets) if (m.base) baseSet.add(m.base);
    let universe = buildUniverse(baseSet);
    if (!universe.length) {
      console.log('[scan:v2] no live markets — skipping');
      scansDone++;
      lastScanAt = Date.now();
      latestOpportunities = [];
      lastTokenCount = 0;
      return { opportunities: [], durationMs: Date.now() - start, exchanges: 0, tokens: 0 };
    }

    // 2. Cross-listing filter: token must be on >= MIN_LISTINGS healthy
    //    agents. This is the same filter as v1, but counts are derived
    //    from the supervisor's view of the world, not from ccxt
    //    directly.
    const listingCount = new Map();
    for (const m of allMarkets) {
      listingCount.set(m.base, (listingCount.get(m.base) || 0) + 1);
    }
    const before = universe.length;
    universe = universe.filter((b) => (listingCount.get(b) || 0) >= MIN_LISTINGS);
    console.log(`[scan:v2] universe filtered ${before} -> ${universe.length} (>=${MIN_LISTINGS} listings)`);

    // Optional: per-user exchange selection
    const selectedSet = (options.selectedExchanges && options.selectedExchanges.length)
      ? new Set(options.selectedExchanges)
      : null;

    // 3. Per-agent book fetch. Each agent enforces its OWN timeout
    //    and circuit-breaker state. If the agent's breaker is open,
    //    fetchOrderBookSafe() returns { ok: false, error: 'backoff' }
    //    in <1ms — no network call, no shared stall.
    const tasks = [];
    for (const base of universe.slice(0, MAX_BASES_PER_CYCLE)) {
      for (const agent of supervisor.agents.values()) {
        if (agent.state === AgentState.SHUTDOWN || agent.state === AgentState.UNSUPPORTED) continue;
        if (selectedSet && !selectedSet.has(agent.id)) continue;
        const market = agent.marketsByBase.get(base);
        if (!market) continue;
        tasks.push({ agent, base, symbol: market.symbol });
      }
    }
    // Bound the total per cycle. With 36 agents × 6632 bases this
    // would be ~240k fetch attempts; we cap at 6000 to keep the
    // cycle under 25s on a good network.
    if (tasks.length > MAX_BOOK_FETCHES_PER_CYCLE) {
      tasks.length = MAX_BOOK_FETCHES_PER_CYCLE;
    }

    // 4. Execute tasks via bounded pool, but each task is fully
    //    isolated by the agent. A throw inside one agent cannot
    //    affect another agent's task.
    const booksByExchange = {};
    const poolSize = Math.min(FETCH_CONCURRENCY, tasks.length);
    let next = 0;
    const workers = Array.from({ length: poolSize }, async () => {
      while (next < tasks.length) {
        const idx = next++;
        const t = tasks[idx];
        const r = await t.agent.fetchOrderBookSafe(t.symbol);
        if (!r.ok) continue;
        if (!booksByExchange[t.agent.id]) booksByExchange[t.agent.id] = [];
        booksByExchange[t.agent.id].push({
          base: t.base,
          symbol: t.symbol,
          book: r.value,
          taker: t.agent.marketsByBase.get(t.base)?.taker || 0.001,
          minAmount: t.agent.marketsByBase.get(t.base)?.limits?.amount?.min || 0,
        });
      }
    });
    await Promise.allSettled(workers);

    // 5. Detect. The detect function is unchanged.
    const detected = detectOpportunities(booksByExchange, options).slice(0, config.maxOpportunities);

    // 6. Volume enrichment. Uses the supervisor's clients so we
    //    benefit from the same connection pool.
    const exchangeMap = {};
    for (const agent of supervisor.agents.values()) {
      if (agent.client) exchangeMap[agent.id] = { client: agent.client, id: agent.id };
    }
    let result = detected;
    try { result = await enrichVolumes(detected, exchangeMap); } catch (e) {
      console.warn('[scan:v2] enrichVolumes failed:', e?.message || e);
    }

    latestOpportunities = result;
    scansDone++;
    lastScanAt = Date.now();
    lastTokenCount = universe.length;
    const durationMs = Date.now() - start;
    lastDurationMs = durationMs;
    lastExchanges = Object.keys(booksByExchange).length;
    lastScannedExchanges = Object.keys(booksByExchange);
    updateHotBases(latestOpportunities.map((o) => o.base));

    addScanHistory(latestOpportunities.length, durationMs, Object.keys(booksByExchange).length)
      .catch((e) => console.warn('[scan] addScanHistory failed:', e?.message || e));
    console.log(`[scan:v2] ${latestOpportunities.length} opps from ${universe.length} tokens in ${durationMs}ms across ${lastExchanges} exchanges`);
    return { opportunities: latestOpportunities, durationMs, exchanges: lastExchanges, tokens: universe.length };
  } catch (e) {
    // Last-resort safety net. The hot path above never throws
    // because every component is wrapped, but bugs happen.
    console.error('[scan:v2] unhandled error:', e?.message || e);
    return { error: String(e?.message || e), opportunities: latestOpportunities };
  } finally {
    scanning = false;
  }
}

export function getScanStats() {
  return {
    scansDone,
    lastScanAt,
    count: latestOpportunities.length,
    tokens: lastTokenCount,
    durationMs: lastDurationMs,
    exchanges: lastExchanges,
    scannedExchanges: lastScannedExchanges,
    live: liveStats(),
  };
}

export function filterForUser(user, selectedExchanges) {
  if (!user) return [];
  const isProUser = isPro(user);
  const baseFiltered = filterByExchanges(latestOpportunities, selectedExchanges);
  // Free users still see every row, but rows at/above FREE_MAX_SPREAD_PERCENT
  // have their identifying fields masked and are flagged with `gated: true` so
  // the frontend can render a blurred card prompting the upgrade. PRO users
  // see the full unredacted opportunity.
  return baseFiltered.map((op) => {
    if (isProUser) return { ...op, gated: false };
    const reveal = op.netProfitPct < FREE_MAX_SPREAD_PERCENT;
    if (reveal) return { ...op, gated: false };
    return {
      ...op,
      base: '••••',
      symbol: '••••/USDT',
      buyExchange: '••••',
      sellExchange: '••••',
      buyPrice: null,
      sellPrice: null,
      netProfitPct: op.netProfitPct,
      netProfitUsdt: op.netProfitUsdt,
      network: op.network,
      networkLabel: op.networkLabel,
      networkAssumed: op.networkAssumed,
      feeSource: op.feeSource,
      contractAddress: op.contractAddress,
      withdrawFee: op.withdrawFee,
      liquidityUsd: op.liquidityUsd,
      buyLiquidityUsd: op.buyLiquidityUsd,
      sellLiquidityUsd: op.sellLiquidityUsd,
      volume24hUsd: op.volume24hUsd,
      buyVolume24hUsd: op.buyVolume24hUsd,
      sellVolume24hUsd: op.sellVolume24hUsd,
      gated: true,
    };
  });
}

function filterByExchanges(opportunities, selectedExchanges) {
  if (!selectedExchanges || selectedExchanges.length === 0) return opportunities;
  const set = new Set(selectedExchanges);
  return opportunities.filter((op) => set.has(op.buyExchange) || set.has(op.sellExchange));
}
