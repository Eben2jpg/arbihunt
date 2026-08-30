import { exchanges } from './exchanges.js';
import { cacheMarkets as cacheMarketsToDb, getCachedMarkets as getCachedMarketsFromDb } from '../db.js';

const SKIP_BASES = new Set(['USD', 'USDC', 'BUSD', 'DAI', 'TUSD', 'EUR', 'GBP', 'TRY', 'FDUSD', 'USDE']);

function isUsdt(value) {
  return /usdt$/i.test(value);
}

// A short hard ceiling: a healthy exchange returns its market list in under 2s.
// Going past 6s means the endpoint is congested from this IP — we use the
// last-good cache instead so the rest of the cycle still scans that venue.
const LOAD_TIMEOUT_MS = 6000;

export async function loadMarkets(exchange) {
  try {
    const markets = await Promise.race([
      exchange.loadMarkets(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('loadMarkets timeout')), LOAD_TIMEOUT_MS)),
    ]);
    const usdt = Object.values(markets)
      .filter((m) => m.active !== false && isUsdt(m.quote) && !isUsdt(m.base) && !SKIP_BASES.has(m.base.toUpperCase()))
      .map((m) => ({
        symbol: m.symbol,
        base: m.base.toUpperCase(),
        quote: m.quote.toUpperCase(),
        taker: m.taker != null ? m.taker : (exchange.fees ? exchange.fees.taker : 0.001),
        limits: m.limits || {},
      }));
    return usdt;
  } catch (e) {
    // Silent: do NOT spam logs every cycle for a chronically-slow exchange.
    // The engine's fallback to cache handles the data path.
    return [];
  }
}

export async function cacheMarkets(exchangeId, markets) {
  await cacheMarketsToDb(exchangeId, markets);
}

export async function getCachedMarkets(exchangeId) {
  return getCachedMarketsFromDb(exchangeId);
}

export function buildUniverse(baseSet) {
  // Universe = union of EVERY USDT base actually listed across all connected
  // exchanges right now, minus stablecoins/fiat quotes. No hardcoded lists —
  // the scan always covers 100% of what is really tradeable.
  const unique = new Set();
  for (const b of baseSet) {
    const up = String(b).toUpperCase();
    if (!up || SKIP_BASES.has(up)) continue;
    unique.add(up);
  }
  return [...unique].sort();
}
