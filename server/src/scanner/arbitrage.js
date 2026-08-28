import { getWithdrawFee, getDefaultNetwork, getCandidateNetworks } from './fees.js';
import { liveFeeFor, bestLiveChainFor, liveNetworksFor } from './liveFees.js';

// Build a fresh opportunity from one exchange's order book.
// We compute the size that can actually be filled from a real basket of
// ask/bid books so thin liquidity cannot fake a big spread.

export function orderBookToSide(book, side) {
  const rows = book[side] || [];
  // Amount is the base quantity at that price level.
  return rows.map(([price, amount]) => ({ price, amount }));
}

// Weighted average fill price for up to `target` base units, plus the
// total quote value and the cumulative depth available.
export function fillPrice(levels, target) {
  let remaining = target;
  let cost = 0;
  let available = 0;
  for (const lvl of levels) {
    const take = Math.min(remaining, lvl.amount);
    cost += take * lvl.price;
    available += take;
    remaining -= take;
    if (remaining <= 0) break;
  }
  if (remaining > 0) return null; // not enough depth for target
  return {
    price: cost / available,
    amount: available,
    value: cost,
  };
}

// Aggregate liquidity available up to a max value (USD) — returns the
// total base amount the book can absorb at the published levels.
export function depthForValue(levels, maxValue) {
  let value = 0;
  let base = 0;
  for (const lvl of levels) {
    const lvlValue = lvl.price * lvl.amount;
    if (value + lvlValue <= maxValue) {
      value += lvlValue;
      base += lvl.amount;
    } else {
      const take = (maxValue - value) / lvl.price;
      base += take;
      value = maxValue;
      break;
    }
  }
  return { base, value };
}

// Compute net profit for a cross-exchange trade at a given size.
// - buy on exchangeA at ask (taker fee A)
// - transfer base A -> B on a matched network (withdrawal fee in base)
// - sell on exchangeB at bid (taker fee B)
export function computeNetProfit({
  buyAsk, buyTakerFee, sellBid, sellTakerFee,
  withdrawFeeBase, sizeBase,
}) {
  // Cost of acquiring `sizeBase` units on the buy leg, incl. taker fee.
  const buyCost = sizeBase * buyAsk;
  const buyFeeCost = buyCost * buyTakerFee;
  const totalBuyCost = buyCost + buyFeeCost;

  // After the withdrawal fee we receive fewer units on the sell leg.
  const receivedBase = Math.max(0, sizeBase - withdrawFeeBase);
  const sellValue = receivedBase * sellBid;
  const sellFeeCost = sellValue * sellTakerFee;
  const netSellValue = sellValue - sellFeeCost;

  const netProfitUsdt = netSellValue - totalBuyCost;
  const netProfitPct = totalBuyCost > 0 ? (netProfitUsdt / totalBuyCost) * 100 : 0;

  return { netProfitUsdt, netProfitPct, receivedBase, totalBuyCost };
}

// Try every candidate network, pick the one that maximizes net profit.
export function bestNetwork(base, sizeBase) {
  const net = getDefaultNetwork(base);
  const candidates = getCandidateNetworks(base);
  const list = net ? [net, ...candidates.filter((n) => n !== net)] : candidates;
  return list;
}

// Tokens missing from the curated fee table still move between venues — they
// just do it on their own/native chain. We do NOT fall back to a proportional
// estimate here: the user only wants real networks and real fees on the
// scanner, so a row that we cannot tie to a real chain is dropped entirely.
const GENERIC_WITHDRAW_PCT = 0.0015; // kept for future use; not used today

// Resolve a single network candidate to a real fee, walking the live cache
// first, then the curated table, then the generic estimate.
//
// Returns { fee, network, networkLabel, networkAssumed, feeSource, contractAddress }
function resolveNetwork({ base, buyExchangeId, sellExchangeId, network, sizeBase }) {
  // 1. Try live cache using the SELL exchange (where the withdrawal happens
  //    after the buy leg) — that's where the fee actually matters.
  const live = liveFeeFor(sellExchangeId, base, network);
  if (live) {
    return {
      fee: live.fee,
      network: live.network || network,
      networkLabel: live.network || network,
      networkAssumed: false,
      feeSource: 'live',
      contractAddress: live.contractAddress || null,
    };
  }
  // 2. Try the curated table.
  const curated = getWithdrawFee(base, network);
  if (curated != null) {
    return {
      fee: curated,
      network,
      networkLabel: network,
      networkAssumed: false,
      feeSource: 'curated',
      contractAddress: null,
    };
  }
  return null;
}

// Try every candidate network across both buy and sell exchanges, picking the
// real fee that maximizes net profit. Source is tracked honestly: 'live' when
// the exchange's own fetchCurrencies answered, 'curated' for the static table,
// 'estimated' only as a last resort.
export function evaluateRoute({ base, buyAsk, buyTakerFee, sellBid, sellTakerFee, sizeBase, buyExchangeId, sellExchangeId }) {
  const candidates = bestNetwork(base, sizeBase);
  let best = null;

  // Add live chains we discovered on either leg, de-duplicated by canonical.
  const seen = new Set(candidates);
  for (const c of liveNetworksFor(sellExchangeId, base)) {
    if (!seen.has(c.chain)) { seen.add(c.chain); candidates.push(c.chain); }
  }
  for (const c of liveNetworksFor(buyExchangeId, base)) {
    if (!seen.has(c.chain)) { seen.add(c.chain); candidates.push(c.chain); }
  }

  for (const network of candidates) {
    const resolved = resolveNetwork({ base, buyExchangeId, sellExchangeId, network, sizeBase });
    if (!resolved) continue;
    const r = computeNetProfit({
      buyAsk, buyTakerFee, sellBid, sellTakerFee,
      withdrawFeeBase: resolved.fee, sizeBase,
    });
    if (!best || r.netProfitUsdt > best.netProfitUsdt) {
      best = { ...r, ...resolved };
    }
  }

  if (!best) {
    // No real network/fees could be resolved on either the live cache or
    // the curated table. Drop this opportunity — the user does not want
    // rows with an "unknown" network on the scanner.
    return null;
  }
  return best;
}
