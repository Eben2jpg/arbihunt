import express from 'express';
import { exchanges } from '../scanner/exchanges.js';
import { getScanStats } from '../scanner/engine.js';
import { getUserCounts } from '../db.js';

const router = express.Router();

router.get('/exchanges', (_req, res) => {
  res.json({ exchanges: exchanges.map((e) => ({ id: e.id, name: e.name })) });
});

// Public platform stats: how many users, scans, tokens, exchanges scanned.
router.get('/stats', async (_req, res) => {
  try {
    const { count, lastScanAt, scansDone, tokens, durationMs, exchanges: scanned, scannedExchanges } = getScanStats();
    res.json({
      users: await getUserCounts(),
      opportunities: count,
      lastScanAt,
      scansDone,
      tokens,
      durationMs,
      exchangesScanned: scanned,
      scannedExchanges,
      exchangesTotal: exchanges.length,
    });
  } catch (e) {
    console.error('[status] stats error:', e?.message || e);
    res.status(500).json({ error: 'Could not load stats' });
  }
});

export default router;
