// Orchestrates the 36 ExchangeAgent instances.
//
// The supervisor is the only thing the engine talks to. It owns:
//   - creation and teardown of all agents
//   - the global hot-bases list (which tokens are worth WS-streaming)
//   - the public health snapshot for the status route
//
// Invariants:
//   - No method on this class throws. Every public method returns a
//     result object or empty/null on failure.
//   - The supervisor never blocks the engine. If 0 agents are healthy,
//     getMarketsSnapshot() returns []. The engine treats that as "skip
//     this cycle" and the loop continues.
//   - Boot is sequential. Cold start takes ~30-60s on Render free tier
//     but uses at most 1 TLS handshake at a time, which avoids the
//     "36 parallel connections from a shared IP" anti-scraping trigger.
//   - Health updates are pushed to a listener so the dashboard can show
//     live FSM transitions.

import { ExchangeAgent, AgentState } from './ExchangeAgent.js';

const HEALTHY_STATES = new Set([AgentState.CONNECTED, AgentState.DEGRADED]);

export class ExchangeSupervisor {
  constructor({ exchanges, onStateChange, onHealthChange } = {}) {
    // exchanges: array of { id, name, client } as built by scanner/exchanges.js
    this._onStateChange = onStateChange || (() => {});
    this._onHealthChange = onHealthChange || (() => {});
    this.agents = new Map();
    this.hotBases = [];
    this._stopped = false;
    this._stateListenerInstalled = false;

    for (const def of exchanges || []) {
      const agent = new ExchangeAgent({
        id: def.id,
        name: def.name || def.id,
        client: def.client,
        onStateChange: (a, prev, next) => this._onStateChange(a, prev, next),
      });
      this.agents.set(def.id, agent);
    }
  }

  // -------------------------------------------------------------------------
  // Lifecycle.
  // -------------------------------------------------------------------------

  // Periodic memory hygiene. Walks every agent, prunes its LRU
  // book cache, drops stale WS live books, and reports a memory
  // snapshot. Intended to be called every 5 minutes from a
  // setInterval. Never throws.
  pruneStale() {
    const now = Date.now();
    let prunedBooks = 0;
    let prunedLive = 0;
    for (const agent of this.agents.values()) {
      if (agent.state === AgentState.SHUTDOWN) continue;
      prunedBooks += agent.bookCache.prune();
      for (const [base, b] of agent.liveBook) {
        if (now - b.timestamp > 120_000) {
          agent.liveBook.delete(base);
          prunedLive++;
        }
      }
    }
    if (prunedBooks || prunedLive) {
      console.log(`[supervisor] prune: removed ${prunedBooks} stale book entries, ${prunedLive} stale live books`);
    }
    // Memory-pressure check. 70% threshold: trigger an aggressive
    // prune early enough to avoid the OOM kill. The OOM happens
    // fast (within seconds) once the heap is over 90%, so we
    // need to react before that.
    const mem = process.memoryUsage();
    const heapMB = Math.round(mem.heapUsed / 1024 / 1024);
    const heapLimitMB = Math.round(mem.heapTotal / 1024 / 1024);
    const rssMB = Math.round(mem.rss / 1024 / 1024);
    if (heapLimitMB > 0 && heapMB / heapLimitMB > 0.7) {
      console.warn(`[supervisor] high memory: ${heapMB}MB / ${heapLimitMB}MB heap, ${rssMB}MB rss — aggressive prune`);
      for (const agent of this.agents.values()) {
        if (agent.state === AgentState.SHUTDOWN) continue;
        agent.bookCache.clear();
        agent.liveBook.clear();
        agent.feeCache.clear();
      }
    }
    return { prunedBooks, prunedLive, heapMB, heapLimitMB, rssMB };
  }

  // Sequential boot. Each agent loads its market list one after the
  // other. Failures are recorded on the agent and never propagate.
  // Returns when every agent has either connected or marked itself
  // disconnected (whichever happens first).
  async init() {
    const startedAt = Date.now();
    for (const agent of this.agents.values()) {
      if (this._stopped) return;
      try {
        await agent.boot();
      } catch (e) {
        // boot() catches internally, but if it ever does throw we
        // must not stop the loop. Mark the agent DISCONNECTED and
        // continue.
        agent._transition(AgentState.DISCONNECTED, `boot threw: ${e?.message || e}`);
      }
    }
    const elapsed = Date.now() - startedAt;
    const healthy = this.getHealthyAgents().length;
    console.log(`[supervisor] boot complete: ${healthy}/${this.agents.size} agents healthy in ${elapsed}ms`);
    this._broadcastHealth();
    return this.healthReport();
  }

  // Kick off WS watchers for every agent that supports watchOrderBook.
  // Non-supporting agents silently stay out.
  startWatchers(hotBases) {
    this.hotBases = hotBases || [];
    for (const agent of this.agents.values()) {
      if (this._stopped) break;
      agent.startWatch(this.hotBases);
    }
  }

  updateHotBases(hotBases) {
    this.hotBases = hotBases || [];
    for (const agent of this.agents.values()) {
      agent.updateHotBases(this.hotBases);
    }
  }

  shutdown() {
    this._stopped = true;
    for (const agent of this.agents.values()) {
      try { agent.stop(); } catch (_) {}
    }
  }

  // -------------------------------------------------------------------------
  // Per-cycle accessors used by the engine.
  // -------------------------------------------------------------------------

  getHealthyAgents() {
    const out = [];
    for (const agent of this.agents.values()) {
      if (HEALTHY_STATES.has(agent.state)) out.push(agent);
    }
    return out;
  }

  // Returns the union of cached markets across every agent. Never
  // throws. Returns [] if every agent is down.
  getMarketsSnapshot() {
    const all = [];
    for (const agent of this.getHealthyAgents()) {
      for (const m of agent.markets) all.push(m);
    }
    return all;
  }

  // Per-base, per-agent book lookup. Agents that are unhealthy but
  // still have a fresh-enough LRU entry contribute tagged as
  // fromCache:true. The engine uses this in the hot path.
  getBooksSnapshot(base) {
    const out = [];
    for (const agent of this.agents.values()) {
      if (agent.state === AgentState.SHUTDOWN) continue;
      const market = agent.marketsByBase.get(base);
      if (!market) continue;
      // Try live first (WS), then LRU cache, then give up.
      const live = agent.getLiveBook(base);
      if (live) {
        out.push({
          exId: agent.id,
          symbol: market.symbol,
          base,
          taker: market.taker,
          minAmount: market.limits?.amount?.min || 0,
          book: live,
          fromCache: false,
          source: 'ws',
        });
        continue;
      }
      const cached = agent.bookCache.get(market.symbol);
      if (cached && HEALTHY_STATES.has(agent.state)) {
        out.push({
          exId: agent.id,
          symbol: market.symbol,
          base,
          taker: market.taker,
          minAmount: market.limits?.amount?.min || 0,
          book: cached,
          fromCache: true,
          source: 'rest-cache',
        });
      }
    }
    return out;
  }

  // Live books only (WS). Returns empty array if no agent is streaming.
  getLiveSnapshot() {
    const out = [];
    for (const agent of this.agents.values()) {
      if (agent.state === AgentState.SHUTDOWN) continue;
      for (const [base, book] of agent.liveBook) {
        const market = agent.marketsByBase.get(base);
        if (!market) continue;
        out.push({
          exId: agent.id,
          symbol: market.symbol,
          base,
          taker: market.taker,
          minAmount: market.limits?.amount?.min || 0,
          book,
          fromCache: false,
          source: 'ws',
        });
      }
    }
    return out;
  }

  // Aggregate report for the status route.
  healthReport() {
    const byState = {};
    for (const agent of this.agents.values()) {
      byState[agent.state] = (byState[agent.state] || 0) + 1;
    }
    const agents = [];
    for (const agent of this.agents.values()) agents.push(agent.snapshot());
    return {
      total: this.agents.size,
      healthy: this.getHealthyAgents().length,
      byState,
      agents,
      hotBases: this.hotBases.length,
    };
  }

  // Lookup helpers used by the engine and live fees path.
  getAgent(id) {
    return this.agents.get(id) || null;
  }

  listAgentIds() {
    return [...this.agents.keys()];
  }

  // -------------------------------------------------------------------------
  // Internal: push health updates to any subscriber (the dashboard).
  // -------------------------------------------------------------------------

  _broadcastHealth() {
    try { this._onHealthChange(this.healthReport()); } catch (_) {}
  }
}
