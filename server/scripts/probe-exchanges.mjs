// Online probe: which of the 36 exchanges are reachable from this host right now?
// Useful for diagnosing scanner coverage. Run with:  node scripts/probe-exchanges.mjs
//
// Output: a status line per exchange + a summary at the end.
import ccxt from 'ccxt';

const IDS = [
  'binance','bybit','okx','kucoin','gate','mexc','bitget','htx','cryptocom',
  'bitfinex','poloniex','whitebit','hitbtc','phemex','coinex','digifinex',
  'bitrue','lbank','xt','latoken','btse','toobit','kraken','bitstamp',
  'bigone','cex','bitso','bitbns','indodax','zebpay','btcturk','coinone',
  'bithumb','upbit','coincheck','bit2c',
];

const TIMEOUT_MS = 8000;
const PARALLEL = 6;

async function probe(id) {
  const Client = ccxt[id];
  if (!Client) return { id, status: 'unsupported', count: 0, ms: 0 };
  const start = Date.now();
  const client = new Client({ enableRateLimit: true, timeout: TIMEOUT_MS });
  try {
    const markets = await Promise.race([
      client.loadMarkets(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), TIMEOUT_MS)),
    ]);
    const usdtCount = Object.values(markets).filter((m) => /\/usdt$/i.test(m.symbol) && m.active !== false).length;
    return { id, status: 'online', count: usdtCount, ms: Date.now() - start };
  } catch (e) {
    return { id, status: 'offline', count: 0, ms: Date.now() - start, error: e.message };
  }
}

async function runPool(items, worker, parallel) {
  const results = new Array(items.length);
  let next = 0;
  const work = async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await worker(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(parallel, items.length) }, work));
  return results;
}

const results = await runPool(IDS, probe, PARALLEL);
let online = 0, offline = 0, unsupported = 0;
for (const r of results.sort((a, b) => a.id.localeCompare(b.id))) {
  const tag = r.status === 'online' ? '✓'
    : r.status === 'offline' ? '✗'
    : '?';
  console.log(`${tag} ${r.id.padEnd(12)} ${String(r.status).padEnd(11)} usdt=${String(r.count).padStart(4)}  ${r.ms}ms${r.error ? '  (' + r.error + ')' : ''}`);
  if (r.status === 'online') online++;
  else if (r.status === 'offline') offline++;
  else unsupported++;
}
console.log(`\n${IDS.length} exchanges probed: ${online} online, ${offline} offline, ${unsupported} unsupported`);
