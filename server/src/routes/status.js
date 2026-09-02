import express from 'express';
import { exchanges } from '../scanner/exchanges.js';
import { getScanStats } from '../scanner/engine.js';
import { getUserCounts } from '../db.js';
import { getSupervisor } from '../supervisor-bridge.js';

const router = express.Router();

router.get('/exchanges', (_req, res) => {
  res.json({ exchanges: exchanges.map((e) => ({ id: e.id, name: e.name })) });
});

// Public platform stats: how many users, scans, tokens, exchanges scanned.
router.get('/stats', async (_req, res) => {
  try {
    const { count, lastScanAt, scansDone, tokens, durationMs, exchanges: scanned, scannedExchanges } = getScanStats();
    const sup = getSupervisor();
    const health = sup ? sup.healthReport() : null;
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
      exchangeHealth: health ? {
        healthy: health.healthy,
        total: health.total,
        byState: health.byState,
      } : null,
    });
  } catch (e) {
    console.error('[status] stats error:', e?.message || e);
    res.status(500).json({ error: 'Could not load stats' });
  }
});

export default router;

