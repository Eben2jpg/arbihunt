import express from 'express';
import { authRequired } from '../middleware/auth.js';
import { getWatchlist, addWatchlist, removeWatchlist } from '../db.js';

const router = express.Router();

router.get('/', authRequired, (req, res) => {
  const rows = getWatchlist(req.user.id);
  res.json({ watchlist: rows.map((r) => ({ id: r.id, symbol: r.symbol })) });
});

router.post('/', authRequired, (req, res) => {
  const { symbol } = req.body || {};
  if (!symbol) return res.status(400).json({ error: 'Symbol required' });
  const row = addWatchlist(req.user.id, symbol);
  if (!row) return res.status(409).json({ error: 'Already in watchlist' });
  res.status(201).json({ ok: true });
});

router.delete('/:symbol', authRequired, (req, res) => {
  removeWatchlist(req.user.id, req.params.symbol);
  res.json({ ok: true });
});

export default router;
