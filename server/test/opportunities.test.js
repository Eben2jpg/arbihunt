// Unit tests for the free/PRO gating logic in scanner/engine.js.
// We test the masking behaviour of filterForUser with a stub latestOpportunities
// and a stub isPro — same shape as the real code.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const FREE_MAX_SPREAD_PERCENT = 1.5;

function filterForUserStub({ user, isProUser, latest, selectedExchanges }) {
  if (!user) return [];
  // Strict filter: BOTH legs must be in the selected set when a set is given.
  const baseFiltered = selectedExchanges?.length
    ? latest.filter((op) => selectedExchanges.includes(op.buyExchange) && selectedExchanges.includes(op.sellExchange))
    : latest;
  // Free users see every row, but rows at/above FREE_MAX_SPREAD_PERCENT are
  // masked and flagged `gated: true` so the UI can render a blurred card.
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
      netProfitPct: op.netProfitPct,
      netProfitUsdt: op.netProfitUsdt,
      network: op.network,
      networkLabel: op.networkLabel,
      networkAssumed: op.networkAssumed,
      withdrawFee: op.withdrawFee,
      liquidityUsd: op.liquidityUsd,
      buyPrice: null,
      sellPrice: null,
      gated: true,
    };
  });
}

const sample = [
  { id: '1', base: 'BTC', symbol: 'BTC/USDT', netProfitPct: 0.5, netProfitUsdt: 5, buyExchange: 'binance', sellExchange: 'bybit', network: 'BTC', networkLabel: 'BTC', networkAssumed: false, withdrawFee: 0.00005, liquidityUsd: 1000, buyPrice: 60000, sellPrice: 60050 },
  { id: '2', base: 'ETH', symbol: 'ETH/USDT', netProfitPct: 1.7, netProfitUsdt: 10, buyExchange: 'binance', sellExchange: 'okx', network: 'ERC-20', networkLabel: 'ERC-20', networkAssumed: false, withdrawFee: 0.001, liquidityUsd: 500, buyPrice: 3000, sellPrice: 3060 },
  { id: '3', base: 'SOL', symbol: 'SOL/USDT', netProfitPct: 0.9, netProfitUsdt: 3, buyExchange: 'kucoin', sellExchange: 'mexc', network: 'SOL', networkLabel: 'SOL', networkAssumed: false, withdrawFee: 0.005, liquidityUsd: 200, buyPrice: 150, sellPrice: 151.3 },
  { id: '4', base: 'PEPE', symbol: 'PEPE/USDT', netProfitPct: 1.4, netProfitUsdt: 1, buyExchange: 'mexc', sellExchange: 'bitget', network: 'ERC-20', networkLabel: 'ERC-20', networkAssumed: true, withdrawFee: 500000, liquidityUsd: 50, buyPrice: 0.00001, sellPrice: 0.0000101 },
];

test('free user: all rows returned, sub-1.5% rows reveal full detail', () => {
  const out = filterForUserStub({ user: { id: 1 }, isProUser: false, latest: sample });
  assert.equal(out.length, 4);
  const btc = out.find((o) => o.base === 'BTC');
  assert.equal(btc.buyPrice, 60000);
  assert.equal(btc.gated, false);
});

test('free user: sub-1.5% row (PEPE 1.4%) is shown in full, not gated', () => {
  const out = filterForUserStub({ user: { id: 1 }, isProUser: false, latest: sample });
  const pepe = out.find((o) => o.base === 'PEPE');
  assert.ok(pepe, 'PEPE row should be present');
  assert.equal(pepe.buyPrice, 0.00001);
  assert.equal(pepe.gated, false);
});

test('free user: 1.5%+ row is masked and flagged gated', () => {
  const out = filterForUserStub({ user: { id: 1 }, isProUser: false, latest: sample });
  const eth = out.find((o) => o.netProfitPct === 1.7);
  assert.ok(eth, 'ETH row should still be present (redacted, not hidden)');
  assert.equal(eth.base, '••••');
  assert.equal(eth.symbol, '••••/USDT');
  assert.equal(eth.buyExchange, '••••');
  assert.equal(eth.sellExchange, '••••');
  assert.equal(eth.buyPrice, null);
  assert.equal(eth.sellPrice, null);
  assert.equal(eth.gated, true);
  // Spread/network/liquidity remain visible to motivate upgrade
  assert.equal(eth.netProfitPct, 1.7);
  assert.equal(eth.network, 'ERC-20');
  assert.equal(eth.liquidityUsd, 500);
});

test('pro user: all opportunities visible with full detail, none gated', () => {
  const out = filterForUserStub({ user: { id: 1 }, isProUser: true, latest: sample });
  assert.equal(out.length, 4);
  const eth = out.find((o) => o.netProfitPct === 1.7);
  assert.equal(eth.buyPrice, 3000);
  assert.equal(eth.gated, false);
});

test('exchange filter narrows the set (strict: both legs must match)', () => {
  const out = filterForUserStub({ user: { id: 1 }, isProUser: true, latest: sample, selectedExchanges: ['kucoin', 'mexc'] });
  // SOL: kucoin→mexc (both in set) — kept
  // PEPE: mexc→bitget (bitget NOT in set) — dropped
  // BTC, ETH — neither leg in set, dropped
  assert.deepEqual(out.map((o) => o.base).sort(), ['SOL']);
});

test('no user: empty result (auth required)', () => {
  const out = filterForUserStub({ user: null, isProUser: false, latest: sample });
  assert.equal(out.length, 0);
});
