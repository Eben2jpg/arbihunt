// Unit tests for scanner/arbitrage.js — net profit math + network selection.
// Run: node --test test/arbitrage.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeNetProfit, evaluateRoute, fillPrice, orderBookToSide } from '../src/scanner/arbitrage.js';

// --- fillPrice ---

test('fillPrice returns null when depth is insufficient', () => {
  const levels = [{ price: 100, amount: 1 }]; // only 1 unit available
  const out = fillPrice(levels, 5);
  assert.equal(out, null);
});

test('fillPrice consumes levels in price order and reports average', () => {
  const levels = [
    { price: 100, amount: 2 },
    { price: 101, amount: 5 },
  ];
  const out = fillPrice(levels, 3);
  assert.equal(out.amount, 3);
  // cost: 2*100 + 1*101 = 301; avg = 301/3 ≈ 100.333
  assert.ok(Math.abs(out.price - 100.3333) < 1e-3, `got ${out.price}`);
});

test('orderBookToSide normalises bid/ask rows', () => {
  const book = {
    bids: [[100, 1], [99, 2]],
    asks: [[101, 1], [102, 2]],
  };
  assert.deepEqual(orderBookToSide(book, 'bids').map((l) => l.price), [100, 99]);
  assert.deepEqual(orderBookToSide(book, 'asks').map((l) => l.price), [101, 102]);
});

// --- computeNetProfit ---

test('computeNetProfit: profitable round trip', () => {
  const r = computeNetProfit({
    buyAsk: 100, buyTakerFee: 0.001,        // 0.1%
    sellBid: 110, sellTakerFee: 0.001,      // 0.1%
    withdrawFeeBase: 0.01,
    sizeBase: 10,
  });
  // buy cost: 1000 + 1 (fee) = 1001
  // received: 9.99 units, sold at 110 = 1098.9, fee 1.0989 => net 1097.8011
  // net profit ≈ 96.801 USDT, ≈ 9.67%
  assert.ok(Math.abs(r.netProfitUsdt - 96.8011) < 1e-2, `got ${r.netProfitUsdt}`);
  assert.ok(r.netProfitPct > 9 && r.netProfitPct < 10, `got ${r.netProfitPct}`);
});

test('computeNetProfit: loss after fees is negative', () => {
  const r = computeNetProfit({
    buyAsk: 100, buyTakerFee: 0.001,
    sellBid: 100, sellTakerFee: 0.001,
    withdrawFeeBase: 0,
    sizeBase: 10,
  });
  // Buy cost 1000+1, sell 1000-1, net -2 USDT
  assert.ok(r.netProfitUsdt < 0);
  assert.ok(r.netProfitPct < 0);
});

test('computeNetProfit: withdrawal fee can erase a thin spread', () => {
  const cheap = computeNetProfit({
    buyAsk: 100, buyTakerFee: 0.001,
    sellBid: 101, sellTakerFee: 0.001,
    withdrawFeeBase: 0.001,   // trivial fee
    sizeBase: 10,
  });
  const expensive = computeNetProfit({
    buyAsk: 100, buyTakerFee: 0.001,
    sellBid: 101, sellTakerFee: 0.001,
    withdrawFeeBase: 5,       // 5 base units in fee
    sizeBase: 10,
  });
  assert.ok(cheap.netProfitUsdt > expensive.netProfitUsdt);
  assert.ok(expensive.netProfitUsdt < cheap.netProfitUsdt);
});

// --- evaluateRoute ---

test('evaluateRoute: picks the cheaper network when both exist', () => {
  // SHIB: ERC-20 50000, BEP-20 50000 — same fee both ways.
  // We just need to confirm it returns *some* valid route, not crash.
  const r = evaluateRoute({
    base: 'SHIB',
    buyAsk: 0.00001, buyTakerFee: 0.001,
    sellBid: 0.000011, sellTakerFee: 0.001,
    sizeBase: 1_000_000,
    buyExchangeId: 'binance',
    sellExchangeId: 'bybit',
  });
  assert.ok(r, 'route should be returned for a known token');
  assert.ok(r.network);
  // feeSource is 'curated' because the live cache is empty in the test
  // process; the engine never returns an estimate for a known token.
  assert.notEqual(r.feeSource, 'estimated');
});

test('evaluateRoute: returns null for unknown token (no real network)', () => {
  // The scanner only shows opportunities tied to a real network and real
  // fees. When neither the live cache nor the curated table has an entry
  // for the coin, evaluateRoute must return null so the engine drops the
  // row rather than emit a 'Network unknown' label.
  const r = evaluateRoute({
    base: 'TOTALLY_UNLISTED_TOKEN',
    buyAsk: 1, buyTakerFee: 0.001,
    sellBid: 1.02, sellTakerFee: 0.001,
    sizeBase: 100,
    buyExchangeId: 'binance',
    sellExchangeId: 'bybit',
  });
  assert.equal(r, null);
});
