import express from 'express';
import { authRequired } from '../middleware/auth.js';
import { getLatestOpportunities, filterForUser, getScanStats } from '../scanner/engine.js';
import { exchanges } from '../scanner/exchanges.js';

const router = express.Router();

router.get('/exchanges', (_req, res) => {
  res.json({ exchanges: exchanges.map((e) => ({ id: e.id, name: e.name })) });
});

router.get('/counts', (_req, res) => {
  const { count, lastScanAt, scansDone, tokens } = getScanStats();
  res.json({ opportunities: count, lastScanAt, scansDone, exchanges: exchanges.length, tokens });
});
// exchanges.length is the full 36 (including venues that failed CCXT class
// lookup) — the public picker must show every venue the platform declares.

router.get('/', authRequired, (req, res) => {
  const selected = req.query.exchanges ? String(req.query.exchanges).split(',').map((s) => s.trim()).filter(Boolean) : [];
  res.json({ opportunities: filterForUser(req.user, selected) });
});

router.get('/public', (req, res) => {
  const selected = req.query.exchanges ? String(req.query.exchanges).split(',').map((s) => s.trim()).filter(Boolean) : [];
  const all = getLatestOpportunities();
  const filtered = selected.length ? all.filter((op) => selected.includes(op.buyExchange) || selected.includes(op.sellExchange)) : all;
  const pub = filtered.slice(0, 8).map((op) => ({
    rank: op.rank,
    base: op.base,
    netProfitPct: op.netProfitPct,
    netProfitUsdt: op.netProfitUsdt,
    buyExchange: op.buyExchange,
    sellExchange: op.sellExchange,
  }));
  res.json({ opportunities: pub });
});

export default router;
