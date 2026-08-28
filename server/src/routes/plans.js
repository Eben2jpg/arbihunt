import express from 'express';
import { authRequired } from '../middleware/auth.js';
import { createPayment, getPaymentsByUser } from '../db.js';
import { PLANS } from '../constants.js';
import { randomToken } from '../auth/crypto.js';
import { config } from '../config.js';

const router = express.Router();

router.get('/', (_req, res) => {
  res.json({ plans: Object.values(PLANS) });
});

router.post('/upgrade', authRequired, (req, res) => {
  const planId = req.body?.planId;
  const plan = Object.values(PLANS).find((p) => p.id === planId);
  if (!plan) return res.status(400).json({ error: 'Invalid plan' });

  const invoiceCode = randomToken(12);
  const network = req.body?.network === 'BEP-20' ? 'BEP-20' : 'TRC-20';
  const address = network === 'TRC-20' ? config.usdt.tronAddress : config.usdt.bscAddress;
  if (!address) return res.status(500).json({ error: 'Payment address not configured on server' });

  const info = createPayment({
    userId: req.user.id,
    invoiceCode,
    network,
    toAddress: address,
    amountUsd: plan.priceUsd,
    plan: plan.id,
    durationDays: plan.days,
  });

  res.json({
    invoice: {
      code: info.invoice_code,
      network: info.network,
      toAddress: info.to_address,
      amountUsd: info.amount_usd,
      plan: plan.name,
      durationDays: info.duration_days,
    },
  });
});

export default router;
