// Lightweight 24h volume enrichment. Only fetch tickers for symbols that
// currently appear in live opportunities (a small bounded set), cached briefly,
// so adding real volume to the dashboard costs almost nothing per scan.

const TICKER_TIMEOUT_MS = 4000;
const CACHE_TTL_MS = 30 * 1000;

const cache = new Map(); // key -> { ts, volume }

async function fetchTicker(client, symbol) {
  try {
    const t = await Promise.race([
      client.fetchTicker(symbol),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), TICKER_TIMEOUT_MS)),
    ]);
    // Prefer base 24h traded volume; fall back to quote volume.
    if (t && t.baseVolume != null && Number(t.baseVolume) > 0) return Number(t.baseVolume);
    if (t && t.quoteVolume != null && Number(t.quoteVolume) > 0) return Number(t.quoteVolume);
    return null;
  } catch (_e) {
    return null;
  }
}

async function volumeFor(exchange, symbol) {
  const key = exchange.id + ':' + symbol;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.ts < CACHE_TTL_MS) return hit.volume;
  const volume = await fetchTicker(exchange, symbol);
  cache.set(key, { ts: Date.now(), volume });
  return volume;
}

// Enrich opportunities with 24h traded volume (notional USD) on both legs.
// `exchangeMap` maps exId -> { client }. Results preserve the input order.
export async function enrichVolumes(opportunities, exchangeMap) {
  return Promise.all(opportunities.map(async (op) => {
    const sellEx = exchangeMap[op.sellExchange];
    const buyEx = exchangeMap[op.buyExchange];
    let sellVol24h = null;
    let buyVol24h = null;
    if (sellEx && sellEx.client) sellVol24h = await volumeFor(sellEx.client, op.sellSymbol);
    if (buyEx && buyEx.client) buyVol24h = await volumeFor(buyEx.client, op.buySymbol);
    const sellVolUsd = sellVol24h != null && op.sellPrice != null ? sellVol24h * op.sellPrice : null;
    const buyVolUsd = buyVol24h != null && op.buyPrice != null ? buyVol24h * op.buyPrice : null;
    return {
      ...op,
      volume24hUsd: Math.max(sellVolUsd || 0, buyVolUsd || 0) || null,
      sellVolume24hUsd: sellVolUsd,
      buyVolume24hUsd: buyVolUsd,
    };
  }));
}