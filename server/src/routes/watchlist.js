import express from 'express';
import { authRequired } from '../middleware/auth.js';
import { getWatchlist, addWatchlist, removeWatchlist } from '../db.js';

const router = express.Router();

router.get('/', authRequired, async (req, res) => {
  try {
    const rows = await getWatchlist(req.user.id);
    res.json({ watchlist: rows.map((r) => ({ id: r.id, symbol: r.symbol })) });
  } catch (e) {
    console.error('[watchlist] get error:', e?.message || e);
    res.status(500).json({ error: 'Could not load watchlist' });
  }
});

router.post('/', authRequired, async (req, res) => {
  try {
    const { symbol } = req.body || {};
    if (!symbol) return res.status(400).json({ error: 'Symbol required' });
    const row = await addWatchlist(req.user.id, symbol);
    if (!row) return res.status(409).json({ error: 'Already in watchlist' });
    res.status(201).json({ ok: true });
  } catch (e) {
    console.error('[watchlist] add error:', e?.message || e);
    res.status(500).json({ error: 'Could not add to watchlist' });
  }
});

router.delete('/:symbol', authRequired, async (req, res) => {
  try {
    await removeWatchlist(req.user.id, req.params.symbol);
    res.json({ ok: true });
  } catch (e) {
    console.error('[watchlist] delete error:', e?.message || e);
    res.status(500).json({ error: 'Could not remove from watchlist' });
  }
});

export default router;
