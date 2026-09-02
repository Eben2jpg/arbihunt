import express from 'express';
import cors from 'cors';
import http from 'http';
import { WebSocketServer } from 'ws';
import { config } from './config.js';
import { runScan, runScanV2, getLatestOpportunities, getScanStats } from './scanner/engine.js';
import { fetchTronTransfers, fetchBscTransfers, getLatestBlockNumber, getConfirmations } from './payments/monitor.js';
import { getPendingPayments, updatePaymentStatus } from './db.js';
import { activatePayment } from './payments/activate.js';
import { liveExchanges as exchanges } from './scanner/exchanges.js';
import { loadMarkets as loadExchangeMarkets, cacheMarkets as cacheMarketsToDb } from './scanner/markets.js';
import { refreshLiveFees, liveFeesStats } from './scanner/liveFees.js';
import { ExchangeSupervisor } from './scanner/supervisor/ExchangeSupervisor.js';
import { setSupervisor } from './supervisor-bridge.js';

// The supervisor owns the 36 ExchangeAgent instances. It boots
// sequentially, runs WS watchers independently per exchange, and
// exposes a health snapshot the dashboard can poll. The current
// engine still talks to the legacy code paths during the migration
// — once Phase 2 lands, the engine will read from the supervisor
// instead of ccxt directly.
const supervisor = new ExchangeSupervisor({
  exchanges,
  onStateChange: (agent, prev, next) => {
    // Surface per-agent transitions on the existing broadcast channel
    // so the dashboard can light up individual exchange dots live.
    broadcast({
      type: 'exchange',
      id: agent.id,
      name: agent.name,
      prev,
      next,
      reason: agent.stateReason,
      timestamp: Date.now(),
    });
  },
});
setSupervisor(supervisor);

const app = express();
// CORS: in production, allow the configured CLIENT_ORIGIN (and any
// Vercel or Render preview URL). In dev, allow any origin so the
// Vite proxy + a local network device both work.
const allowedOrigins = (config.clientOrigin || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const isDev = process.env.NODE_ENV !== 'production';
app.use(
  cors({
    origin(origin, cb) {
      if (isDev) return cb(null, true);
      if (!origin) return cb(null, true); // curl, server-to-server
      if (allowedOrigins.includes(origin)) return cb(null, true);
      // Vercel preview URLs look like https://arbihunt-<hash>.vercel.app
      if (/^https:\/\/[\w-]+\.vercel\.app$/.test(origin)) return cb(null, true);
      // Render preview URLs look like https://arbihunt-client-<hash>.onrender.com
      if (/^https:\/\/[\w-]+\.onrender\.com$/.test(origin)) return cb(null, true);
      return cb(new Error('CORS: origin not allowed: ' + origin));
    },
    credentials: true,
  })
);
app.use(express.json());

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

// Tracks the set of base symbols that appeared in the most recent scan
// (relative to the previous one) so the WS can push "fresh tokens" to
// clients as soon as the cycle finishes.
let lastUniverse = new Set();
let lastOppsByBase = new Map();

function broadcast(event) {
  const payload = JSON.stringify(event);
  for (const client of wss.clients) {
    if (client.readyState === 1) {
      try { client.send(payload); } catch (_) {}
    }
  }
}

wss.on('connection', (ws) => {
  const send = () => {
    const opps = getLatestOpportunities().slice(0, 100);
    ws.send(JSON.stringify({
      type: 'opportunities',
      data: opps,
      stats: getScanStats(),
      universe: [...lastUniverse].length,
    }));
  };
  ws.on('message', () => send());
  send();
  // 12s poll keeps the dashboard in sync if the server missed a tick; the
  // server also pushes a "tick" event after every scan.
  const timer = setInterval(send, 12000);
  ws.on('close', () => clearInterval(timer));
});

app.use('/api/auth', (await import('./routes/auth.js')).default);
app.use('/api/opportunities', (await import('./routes/opportunities.js')).default);
app.use('/api/watchlist', (await import('./routes/watchlist.js')).default);
app.use('/api/plans', (await import('./routes/plans.js')).default);
app.use('/api/payments', (await import('./routes/payments.js')).default);
app.use('/api/status', (await import('./routes/status.js')).default);
app.use('/api/admin', (await import('./routes/admin.js')).default);

app.get('/api/health', (_req, res) => res.json({ ok: true, time: Date.now() }));

// Public ticker: returns the current universe of /USDT bases, the latest
// opportunities, and what changed since the previous tick. Used by the
// client to render "fresh tokens this cycle" without polling opportunities.
app.get('/api/ticker', (_req, res) => {
  const stats = getScanStats();
  const opps = getLatestOpportunities();
  const bases = new Set();
  for (const o of opps) if (o.base) bases.add(o.base);
  const health = (() => { try { return supervisor.healthReport(); } catch (_) { return null; } })();
  res.json({
    timestamp: Date.now(),
    lastScanAt: stats.lastScanAt,
    scansDone: stats.scansDone,
    durationMs: stats.durationMs,
    exchangesScanned: stats.exchanges,
    exchangesTotal: 36,
    universeSize: lastUniverse.size,
    opportunityCount: opps.length,
    opportunityBases: [...bases],
    live: stats.live,
    exchangeHealth: health ? { healthy: health.healthy, total: health.total, byState: health.byState } : null,
  });
});

let scanTimer = null;
let consecutiveErrors = 0;
const ERROR_BACKOFF_MS = 5000;

async function tick() {
  console.log('[scan] starting...');
  try {
    // V2 reads from the supervisor (36 isolated agents). Falls back
    // to v1 if the supervisor hasn't booted yet.
    const result = await runScanV2(config);
    consecutiveErrors = 0; // a successful cycle resets the counter
    const stats = getScanStats();
    console.log(`[scan] ${stats.count} opps in ${stats.durationMs}ms across ${stats.exchanges} exchanges`);

    // Build a fresh set of "this cycle" tokens so the WS can broadcast the
    // ones that just appeared. Fresh = present in the new universe but
    // not in the previous cycle's universe.
    const previousUniverse = lastUniverse;
    const newUniverse = new Set();
    for (const o of getLatestOpportunities()) if (o.base) newUniverse.add(o.base);
    const freshBases = [...newUniverse].filter((b) => !previousUniverse.has(b));
    lastUniverse = newUniverse;

    broadcast({
      type: 'tick',
      timestamp: Date.now(),
      stats,
      opportunityCount: stats.count,
      freshTokens: freshBases,
    });
  } catch (e) {
    consecutiveErrors++;
    console.error(`[scan] error (${consecutiveErrors}):`, e?.message || e);
    if (consecutiveErrors >= 3) {
      await new Promise((r) => setTimeout(r, ERROR_BACKOFF_MS));
    }
  }
}
async function startScanner() {
  // Boot pre-warm: kick off parallel market-list fetches so even before the
  // first scan finishes, every exchange has a populated cache to read from.
  prewarmMarketCache();
  // In parallel, fetch each exchange's currency/withdraw-fee table so the
  // engine can use real fees (not the curated fallback) on the first cycle.
  refreshLiveFees(exchanges.map((e) => ({ id: e.id, client: e.client })))
    .then((stats) => console.log(`[livefees] refreshed: reachable=${stats.reachable}/${stats.reachable + stats.unreachable} coins=${stats.coins} networks=${stats.networks}`))
    .catch((e) => console.log('[livefees] refresh failed:', e.message));
  // In parallel, boot the supervisor: 36 isolated ExchangeAgents,
  // each with its own FSM, circuit breaker, and per-agent caches.
  // A failure on one agent cannot stop the others from booting.
  supervisor.init()
    .then((report) => {
      console.log(`[supervisor] ${report.healthy}/${report.total} healthy, byState=${JSON.stringify(report.byState)}`);
      // Start WS watchers once boot is done. Hot bases start with the
      // majors; the engine will update them after every scan.
      supervisor.startWatchers(['BTC', 'ETH', 'SOL', 'XRP', 'BNB', 'DOGE', 'ADA', 'AVAX', 'LINK', 'TON']);
    })
    .catch((e) => console.error('[supervisor] init failed:', e?.message || e));
  // Memory hygiene: every 60 seconds, prune stale LRU + WS entries
  // and check heap pressure. Cheap, never throws. 60s interval
  // (not 5 min) because the OOM can hit within a few minutes when
  // many agents are streaming WS frames at high frequency.
  setInterval(() => { try { supervisor.pruneStale(); } catch (_) {} }, 60 * 1000).unref();
  await tick();
  const loop = async () => {
    await tick();
    // Push the current hot-bases (from the latest opportunities) to
    // every agent's WS watcher so the streamed set stays relevant.
    try { supervisor.updateHotBases(latestHotBases()); } catch (_) {}
    scanTimer = setTimeout(loop, config.scanIntervalMs);
  };
  scanTimer = setTimeout(loop, config.scanIntervalMs);
}

// Hot bases the WS layer should stream. Mirrors the old MAJOR_BASES
// list plus anything the engine surfaced as a real opportunity in the
// most recent scan. Bounded to 40.
function latestHotBases() {
  const set = new Set(['BTC', 'ETH', 'SOL', 'XRP', 'BNB', 'DOGE', 'ADA', 'AVAX', 'LINK', 'TON']);
  for (const o of getLatestOpportunities()) {
    if (o && o.base) set.add(String(o.base).toUpperCase());
    if (set.size >= 40) break;
  }
  return [...set];
}

async function prewarmMarketCache() {
  // Bounded parallelism so we don't open 36 simultaneous TLS sessions.
  const queue = [...exchanges];
  const workers = Array.from({ length: 6 }, async () => {
    while (queue.length) {
      const ex = queue.shift();
      if (!ex) return;
      try {
        const markets = await loadExchangeMarkets(ex.client);
        if (markets && markets.length) {
          await cacheMarketsToDb(ex.id, markets);
          // Seed the in-memory universe with these bases immediately.
          for (const m of markets) lastUniverse.add(m.base);
          console.log(`[prewarm] ${ex.id}: ${markets.length} USDT markets cached`);
        }
      } catch (_) {}
    }
  });
  await Promise.all(workers);
}

// Per-agent FSM snapshot. Powers the dashboard's exchange-health
// grid and is also useful for the admin panel.
function _getHealthReport() { try { return supervisor.healthReport(); } catch (_) { return null; } }
app.get('/api/status/exchanges', (_req, res) => {
  const report = _getHealthReport();
  if (!report) return res.status(503).json({ error: 'supervisor not ready' });
  res.json(report);
});

startScanner();

// Drain the supervisor cleanly on shutdown so WS sockets and timers
// don't outlive the process.
function shutdown(reason) {
  console.log(`[shutdown] ${reason} — draining supervisor`);
  try { supervisor.shutdown(); } catch (_) {}
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

async function monitorPayments() {
  try {
    const invoices = await getPendingPayments();
    for (const inv of invoices) {
      try {
        let txs = [];
        if (inv.network === 'TRC-20') txs = await fetchTronTransfers(inv.to_address);
        else if (inv.network === 'BEP-20') txs = await fetchBscTransfers(inv.to_address);

        const matching = txs.find((t) => t.to && t.to.toLowerCase() === inv.to_address.toLowerCase());
        if (!matching) continue;
        const paid = Math.abs(matching.amount || 0);
        if (paid < inv.amount_usd * 0.98) continue;

        const required = inv.network === 'TRC-20' ? config.usdt.confirmationsTron : config.usdt.confirmationsBsc;
        const tip = await getLatestBlockNumber(inv.network);
        const confs = getConfirmations(tip, matching.blockNumber);
        if (confs < required) {
          await updatePaymentStatus(inv.id, { confirmations: confs, tx_hash: matching.tx_hash, tx_amount: paid });
          continue;
        }

        await activatePayment(inv, { confirmations: confs, txHash: matching.tx_hash, amount: paid });
      } catch (e) {
        console.warn('[payment] monitor error', e.message);
      }
    }
  } catch (e) {
    console.warn('[payment] monitor loop error', e.message);
  }
}

setInterval(monitorPayments, 60000);
setTimeout(monitorPayments, 30000);

server.listen(config.port, '0.0.0.0', () => {
  console.log(`ArbiHunt server listening on http://0.0.0.0:${config.port}`);
  console.log(`WebSocket ready at ws://0.0.0.0:${config.port}/ws`);
});
