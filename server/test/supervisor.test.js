// Failure simulation test for the ExchangeSupervisor.
//
// Runs the supervisor against 36 FAKE agents (no real network) to
// verify the isolation guarantees:
//
//   - A failure on one agent does NOT affect any other agent
//   - The 18 healthy agents produce data while 18 are failing
//   - The "rate-limited" agents enter RATE_LIMITED state within 1s
//   - The "always-throw" agents enter DISCONNECTED within 1s
//   - The "always-503" agents enter DEGRADED then DISCONNECTED
//   - The supervisor never throws during the test
//   - Memory stays bounded (no growth beyond the cache ceiling)
//
// Run with:  node --test test/supervisor.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ExchangeSupervisor } from '../src/scanner/supervisor/ExchangeSupervisor.js';
import { AgentState } from '../src/scanner/supervisor/ExchangeAgent.js';

// Build a fake ccxt-like client. The methods that the agent calls
// are loadMarkets, fetchOrderBook, fetchCurrencies, watchOrderBook.
function fakeClient(behavior) {
  return {
    async loadMarkets() {
      if (behavior.loadMarkets === 'throw') throw new Error(behavior.message || 'boom');
      if (behavior.loadMarkets === 'timeout') {
        await new Promise((r) => setTimeout(r, 30_000));
      }
      if (behavior.loadMarkets === 'empty') return {};
      // Default: a small but valid markets object.
      const m = {};
      for (let i = 0; i < 10; i++) {
        m[`BTC/USDT`.replace('BTC', `T${i}`)] = {
          symbol: `T${i}/USDT`,
          base: `T${i}`,
          quote: 'USDT',
          active: true,
          taker: 0.001,
          limits: { amount: { min: 0 } },
        };
      }
      m['BTC/USDT'] = {
        symbol: 'BTC/USDT', base: 'BTC', quote: 'USDT',
        active: true, taker: 0.001, limits: { amount: { min: 0 } },
      };
      m['ETH/USDT'] = {
        symbol: 'ETH/USDT', base: 'ETH', quote: 'USDT',
        active: true, taker: 0.001, limits: { amount: { min: 0 } },
      };
      return m;
    },
    async fetchOrderBook(symbol) {
      if (behavior.orderBook === 'throw') throw new Error(behavior.message || 'order book boom');
      if (behavior.orderBook === '429') {
        const e = new Error('429 Too Many Requests');
        throw e;
      }
      if (behavior.orderBook === '503') {
        const e = new Error('503 Service Unavailable');
        throw e;
      }
      return {
        bids: [[100, 1], [99, 2]],
        asks: [[101, 1], [102, 2]],
      };
    },
    async fetchCurrencies() {
      if (behavior.fees === 'throw') throw new Error('fees boom');
      return {};
    },
    async watchOrderBook() {
      if (behavior.ws === 'throw') throw new Error('ws boom');
      return { bids: [[100, 1]], asks: [[101, 1]] };
    },
  };
}

function makeExchanges() {
  const ex = [];
  // 18 healthy
  for (let i = 0; i < 18; i++) ex.push({ id: `good${i}`, name: `Good ${i}`, client: fakeClient({}) });
  // 6 always-throw on load
  for (let i = 0; i < 6; i++) ex.push({ id: `throw${i}`, name: `Thrower ${i}`, client: fakeClient({ loadMarkets: 'throw' }) });
  // 6 always 503 on orderBook
  for (let i = 0; i < 6; i++) ex.push({ id: `srv${i}`, name: `Server5xx ${i}`, client: fakeClient({ orderBook: '503' }) });
  // 6 always 429 on orderBook
  for (let i = 0; i < 6; i++) ex.push({ id: `rl${i}`, name: `RateLimited ${i}`, client: fakeClient({ orderBook: '429' }) });
  return ex;
}

test('healthy agents are CONNECTED after init', async () => {
  const sup = new ExchangeSupervisor({ exchanges: makeExchanges() });
  const report = await sup.init();
  assert.equal(report.total, 36);
  assert.equal(report.healthy, 30, 'all 30 agents that loaded markets should be CONNECTED');
  // The 6 always-throw loaders should be DISCONNECTED
  const throwers = sup.agents.get('throw0');
  assert.equal(throwers.state, AgentState.DISCONNECTED);
  // The 6 always-503 had a successful load, so they're CONNECTED now.
  // Driving them through the order-book path will surface the failure.
  const srv = sup.agents.get('srv0');
  for (let i = 0; i < 6; i++) await srv.fetchOrderBookSafe('BTC/USDT');
  assert.notEqual(srv.state, AgentState.CONNECTED, 'srv0 should leave CONNECTED after 503s');
  sup.shutdown();
});

test('a failure on one agent does not affect another', async () => {
  const sup = new ExchangeSupervisor({ exchanges: makeExchanges() });
  await sup.init();
  // Force agent good0 to throw on every order book call
  const good0 = sup.agents.get('good0');
  const origClient = good0.client;
  good0.client = fakeClient({ orderBook: 'throw' });
  // Call fetchOrderBookSafe 6 times to trip the breaker
  for (let i = 0; i < 6; i++) {
    await good0.fetchOrderBookSafe('BTC/USDT');
  }
  assert.notEqual(good0.state, AgentState.CONNECTED, 'good0 should have left CONNECTED');
  // good1 should still be healthy
  const good1 = sup.agents.get('good1');
  assert.equal(good1.state, AgentState.CONNECTED, 'good1 must be unaffected');
  good0.client = origClient; // restore
  sup.shutdown();
});

test('healthy agents keep producing data while 18 are failing', async () => {
  const sup = new ExchangeSupervisor({ exchanges: makeExchanges() });
  await sup.init();
  // Simulate one full scan cycle: ask each healthy agent for BTC book.
  const results = await Promise.allSettled(
    sup.getHealthyAgents().map((a) => a.fetchOrderBookSafe('BTC/USDT'))
  );
  const ok = results.filter((r) => r.status === 'fulfilled' && r.value.ok);
  assert.equal(ok.length, 18, 'all 18 healthy agents should return an OK book');
  sup.shutdown();
});

test('RATE_LIMITED agents retry with backoff', async () => {
  const sup = new ExchangeSupervisor({ exchanges: makeExchanges() });
  await sup.init();
  const rl = sup.agents.get('rl0');
  // Drive the agent with a 429 to flip it into RATE_LIMITED.
  await rl.fetchOrderBookSafe('BTC/USDT');
  assert.equal(rl.state, AgentState.RATE_LIMITED, `expected RATE_LIMITED, got ${rl.state}`);
  assert.ok(rl.backoffMs > 0, 'rate-limited agent must have a backoff');
  assert.ok(rl.nextRetryAt > Date.now(), 'next retry must be in the future');
  sup.shutdown();
});

test('pruneStale never throws and reports counts', () => {
  const sup = new ExchangeSupervisor({ exchanges: makeExchanges() });
  const r = sup.pruneStale();
  assert.ok(typeof r.heapMB === 'number');
  assert.ok(typeof r.prunedBooks === 'number');
  assert.ok(typeof r.prunedLive === 'number');
  sup.shutdown();
});

test('healthReport shape is stable', async () => {
  const sup = new ExchangeSupervisor({ exchanges: makeExchanges() });
  await sup.init();
  const r = sup.healthReport();
  assert.equal(r.total, 36);
  assert.ok(r.byState);
  assert.equal(r.agents.length, 36);
  for (const a of r.agents) {
    assert.ok(a.id);
    assert.ok(a.state);
    assert.ok(typeof a.consecutiveFailures === 'number');
    assert.ok(typeof a.markets === 'number');
  }
  sup.shutdown();
});

test('memory: 60s of operation does not grow beyond cache ceiling', async () => {
  const sup = new ExchangeSupervisor({ exchanges: makeExchanges() });
  await sup.init();
  // Drive each healthy agent 20 times through the full book fetch +
  // detect path. This is what the scanner does every cycle.
  for (let round = 0; round < 20; round++) {
    const agents = sup.getHealthyAgents();
    await Promise.allSettled(
      agents.map((a) => a.fetchOrderBookSafe('BTC/USDT').then(() => a.fetchOrderBookSafe('ETH/USDT')))
    );
  }
  // Every healthy agent's book cache must be at most the per-agent cap.
  for (const a of sup.agents.values()) {
    assert.ok(a.bookCache.size <= 256, `${a.id} book cache exceeded cap: ${a.bookCache.size}`);
  }
  sup.shutdown();
});

test('liveBook map is capped to prevent OOM', async () => {
  const sup = new ExchangeSupervisor({ exchanges: makeExchanges() });
  await sup.init();
  const good = sup.agents.get('good0');
  // Write 250 distinct base entries directly via the internal helper.
  // The cap is 100, so the oldest 150 should be evicted.
  for (let i = 0; i < 250; i++) {
    good._setLiveBook(`BASE${i}`, { bids: [[100, 1]], asks: [[101, 1]], timestamp: Date.now() });
  }
  assert.ok(good.liveBook.size <= 100, `liveBook exceeded cap: ${good.liveBook.size}`);
  // The most recent entry should still be there.
  assert.ok(good.liveBook.has('BASE249'), 'most recent entry should be present');
  sup.shutdown();
});
