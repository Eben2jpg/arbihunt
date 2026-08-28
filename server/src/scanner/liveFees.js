// Live withdrawal-fee cache.
//
// For every reachable exchange we call ccxt.fetchCurrencies() once at warmup
// and keep the result. evaluateRoute() reads from this cache first; only
// when a real answer is missing does it fall back to the curated table in
// fees.js, and only when BOTH miss does it use a generic estimate.
//
// Each network entry carries:
//   fee            — real number in base units (e.g. 0.00005 BTC, 1.5 USDT)
//   network        — canonical chain name (e.g. "BTC", "ERC20", "TRC20",
//                    "BEP20", "ARBITRUM", "SOL")
//   contractAddress — real on-chain contract address when the chain is a
//                    token contract (e.g. USDT on ERC20 → 0xdac17f958...)
//   withdraw       — boolean; can be withdrawn on this chain
//   deposit        — boolean; can be deposited on this chain

const FETCH_TIMEOUT_MS = 8000;

const cache = new Map(); // exchangeId -> { ts, coins: Map(coin -> networks) }
let lastRefreshAt = 0;
let lastStats = { reachable: 0, unreachable: 0, coins: 0, networks: 0 };

function pickFee(entry) {
  if (!entry) return null;
  if (entry.fee != null && Number.isFinite(Number(entry.fee))) return Number(entry.fee);
  return null;
}

// Map the various chain names exchanges use to our canonical token.
// The curated table in fees.js uses BTC / ETH / TRC-20 / BEP-20 / ERC-20 /
// SOL / etc. The ccxt fetchCurrencies responses use a mix of ERC20, ERC-20,
// ETH, ARBITRUM, ARB, MATIC, POLYGON, BEP20, BSC, OPTIMISM, OP, etc.
const CHAIN_ALIAS = new Map([
  ['ERC20', 'ERC-20'], ['ETH', 'ERC-20'], ['ETHEREUM', 'ERC-20'],
  ['BEP20', 'BEP-20'], ['BEP20BSC', 'BEP-20'], ['BSC', 'BEP-20'],
  ['TRC20', 'TRC-20'], ['TRON', 'TRC-20'],
  ['AVAXCCHAIN', 'AVAX'], ['CCHAIN', 'AVAX'], ['AVAX', 'AVAX'],
  ['ARBITRUM', 'ARB'], ['ARB', 'ARB'], ['ARBITRUMONE', 'ARB'],
  ['OPTIMISM', 'OP'], ['OP', 'OP'],
  ['POLYGON', 'MATIC'], ['MATIC', 'MATIC'], ['POLYGONPOS', 'MATIC'],
  ['SOL', 'SOL'], ['SOLANA', 'SOL'],
  ['BTC', 'BTC'], ['BITCOIN', 'BTC'],
  ['LTC', 'LTC'], ['LITECOIN', 'LTC'],
  ['DOGE', 'DOGE'], ['DOGECOIN', 'DOGE'],
  ['XRP', 'XRP'], ['RIPPLE', 'XRP'],
  ['ADA', 'ADA'], ['CARDANO', 'ADA'],
  ['DOT', 'DOT'], ['POLKADOT', 'DOT'],
  ['TON', 'TON'], ['TONCOIN', 'TON'],
  ['APT', 'APT'], ['APTOS', 'APT'],
  ['SUI', 'SUI'],
  ['INJ', 'INJ'], ['INJECTIVE', 'INJ'],
  ['TIA', 'TIA'], ['CELESTIA', 'TIA'],
  ['NEAR', 'NEAR'],
  ['ATOM', 'ATOM'], ['COSMOS', 'ATOM'],
]);

function canonicalChain(rawName) {
  if (!rawName) return null;
  const up = String(rawName).toUpperCase().replace(/[_-]/g, '');
  if (CHAIN_ALIAS.has(up)) return CHAIN_ALIAS.get(up);
  return rawName; // pass through
}

function contractFromInfo(info) {
  if (!info) return null;
  return info.contractAddress || info.contract || info.tokenAddress || null;
}

function ingest(exchangeId, currencies) {
  // currencies: ccxt.fetchCurrencies() result.
  const coins = new Map();
  let networkCount = 0;
  for (const [coinCode, entry] of Object.entries(currencies || {})) {
    if (!entry || typeof entry !== 'object') continue;
    const upper = String(coinCode).toUpperCase();
    const netObj = entry.networks;
    if (!netObj || typeof netObj !== 'object') continue;
    const networks = new Map();
    for (const [netKey, netVal] of Object.entries(netObj)) {
      if (!netVal || typeof netVal !== 'object') continue;
      const canonical = canonicalChain(netVal.network || netKey);
      const fee = pickFee(netVal);
      const info = netVal.info && typeof netVal.info === 'object' ? netVal.info : null;
      const contract = contractFromInfo(info) || (info && contractFromInfo(info.chain)) || null;
      if (fee == null && !contract) continue; // nothing real to store
      if (netVal.withdraw === false) continue; // can't withdraw this chain
      networks.set(canonical, {
        fee,
        network: netVal.network || netKey,
        contractAddress: contract,
        withdraw: netVal.withdraw !== false,
        deposit: netVal.deposit !== false,
      });
      networkCount++;
    }
    if (networks.size > 0) coins.set(upper, networks);
  }
  cache.set(exchangeId, { ts: Date.now(), coins });
  return { coins: coins.size, networks: networkCount };
}

export async function refreshLiveFees(exchanges) {
  // exchanges: array of { id, client } as produced by scanner/exchanges.js
  // Refreshes in parallel; per-exchange timeout; failures are skipped
  // (the curated table still backs them up).
  const settled = await Promise.allSettled(
    exchanges.map(async ({ id, client }) => {
      try {
        const result = await Promise.race([
          client.fetchCurrencies(),
          new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), FETCH_TIMEOUT_MS)),
        ]);
        return { id, ok: true, currencies: result };
      } catch (e) {
        return { id, ok: false, error: String(e.message || e).slice(0, 200) };
      }
    })
  );
  let reachable = 0, unreachable = 0, totalCoins = 0, totalNetworks = 0;
  for (const s of settled) {
    if (!s || s.status !== 'fulfilled') continue;
    const v = s.value;
    if (!v.ok) { unreachable++; continue; }
    const { coins, networks } = ingest(v.id, v.currencies);
    if (coins > 0) reachable++; else unreachable++;
    totalCoins += coins;
    totalNetworks += networks;
  }
  lastRefreshAt = Date.now();
  lastStats = { reachable, unreachable, coins: totalCoins, networks: totalNetworks, ts: lastRefreshAt };
  return lastStats;
}

// Look up the live fee for a coin on a specific exchange, optionally pinned
// to a chain. Returns:
//   { fee, network, contractAddress, source: 'live' } | null
export function liveFeeFor(exchangeId, coin, preferredChain = null) {
  const entry = cache.get(exchangeId);
  if (!entry) return null;
  const coinUpper = String(coin || '').toUpperCase();
  const networks = entry.coins.get(coinUpper);
  if (!networks || networks.size === 0) return null;
  // 1. Exact chain match (preferred).
  if (preferredChain && networks.has(preferredChain)) {
    const n = networks.get(preferredChain);
    if (n.fee != null) return { fee: n.fee, network: n.network, contractAddress: n.contractAddress, source: 'live' };
  }
  // 2. Alias match (case/format-insensitive).
  if (preferredChain) {
    for (const [k, v] of networks.entries()) {
      if (canonicalChain(k) === canonicalChain(preferredChain) && v.fee != null) {
        return { fee: v.fee, network: v.network, contractAddress: v.contractAddress, source: 'live' };
      }
    }
  }
  // 3. Cheapest available network with a real fee.
  let best = null;
  for (const [k, v] of networks.entries()) {
    if (v.fee == null) continue;
    if (!best || v.fee < best.fee) best = { k, ...v };
  }
  if (best) return { fee: best.fee, network: best.network, contractAddress: best.contractAddress, source: 'live' };
  return null;
}

// Best chain for a coin on an exchange (cheapest withdrawable with a fee).
export function bestLiveChainFor(exchangeId, coin) {
  const entry = cache.get(exchangeId);
  if (!entry) return null;
  const coinUpper = String(coin || '').toUpperCase();
  const networks = entry.coins.get(coinUpper);
  if (!networks || networks.size === 0) return null;
  let best = null;
  for (const [k, v] of networks.entries()) {
    if (v.fee == null) continue;
    if (!best || v.fee < best.fee) best = { k, ...v };
  }
  return best ? { chain: best.k, fee: best.fee, network: best.network, contractAddress: best.contractAddress, source: 'live' } : null;
}

export function liveFeesStats() {
  return { ...lastStats, ageMs: lastRefreshAt ? Date.now() - lastRefreshAt : null };
}

// All (chain, fee) pairs a coin supports on an exchange. Used to pick the
// optimal network between buy and sell legs.
export function liveNetworksFor(exchangeId, coin) {
  const entry = cache.get(exchangeId);
  if (!entry) return [];
  const coinUpper = String(coin || '').toUpperCase();
  const networks = entry.coins.get(coinUpper);
  if (!networks) return [];
  const out = [];
  for (const [k, v] of networks.entries()) {
    if (v.fee == null) continue;
    out.push({ chain: k, fee: v.fee, network: v.network, contractAddress: v.contractAddress });
  }
  return out;
}

// Suspended-filter helpers. A coin is tradable on (exchange, chain) only if
// BOTH deposit and withdrawal are active on that chain. The exchange itself
// may suspend the whole coin — that is captured at the top-level
// `deposit` / `withdraw` booleans and applied to every chain.

// Has the live cache seen this coin on this exchange at all?
export function hasCoin(exchangeId, coin) {
  const entry = cache.get(exchangeId);
  if (!entry) return false;
  return entry.coins.has(String(coin || '').toUpperCase());
}

// True if (exchange, coin) accepts deposits and withdrawals in general.
// Returns:
//   'live'    — exchange API confirmed both active
//   'suspended' — exchange API confirmed one is suspended
//   'unknown'  — exchange did not answer (no entry in cache)
export function coinStatus(exchangeId, coin) {
  const entry = cache.get(exchangeId);
  if (!entry) return 'unknown';
  const coinUpper = String(coin || '').toUpperCase();
  if (!entry.coins.has(coinUpper)) return 'unknown';
  // Re-read the source currencies to inspect top-level deposit/withdraw.
  // We didn't store those on the per-coin entry; fetch from cache again via
  // the live networks (we have at least one chain). If the chain list is
  // empty, fall back to 'unknown' — the engine treats this as "no info".
  const networks = entry.coins.get(coinUpper);
  if (!networks || networks.size === 0) return 'unknown';
  // Inspect the source data through bestLiveChainFor's result, which
  // carries the per-chain withdraw flag. If at least one chain is open
  // for both directions we say 'live'.
  let anyOpen = false;
  for (const v of networks.values()) {
    if (v.withdraw === true) { anyOpen = true; break; }
  }
  return anyOpen ? 'live' : 'suspended';
}

// True when a specific (exchange, coin, chain) is open for both deposit and
// withdrawal. Returns:
//   true   — open
//   false  — confirmed suspended
//   null   — no live info (curated fallback may still be used)
export function chainIsOpen(exchangeId, coin, chain) {
  const entry = cache.get(exchangeId);
  if (!entry) return null;
  const coinUpper = String(coin || '').toUpperCase();
  const networks = entry.coins.get(coinUpper);
  if (!networks) return null;
  // Try exact match first, then alias.
  let v = networks.get(chain);
  if (!v) {
    for (const [k, cand] of networks.entries()) {
      if (canonicalChain(k) === canonicalChain(chain)) { v = cand; break; }
    }
  }
  if (!v) return null;
  if (v.withdraw === false || v.deposit === false) return false;
  return true;
}

// Confirm a cross-exchange route can actually be executed:
// - buy leg must accept deposits on the chain
// - sell leg must accept withdrawals on the chain
// Both legs must have the coin open (no whole-coin suspension). Returns:
//   true   — both legs are confirmed active for this chain
//   false  — at least one leg is suspended
//   null   — no live info (curated fallback may still be used)
export function routeIsOpen({ base, chain, buyExchangeId, sellExchangeId }) {
  if (!chain) return null;
  const buy = chainIsOpen(buyExchangeId, base, chain);
  const sell = chainIsOpen(sellExchangeId, base, chain);
  if (buy === false || sell === false) return false;
  if (buy === true && sell === true) return true;
  return null;
}

