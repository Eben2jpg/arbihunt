import express from 'express';
import { authRequired } from '../middleware/auth.js';
import { getPaymentsByUser, getUserById, isPro, updatePaymentStatus } from '../db.js';
import { fetchTronTransfers, fetchBscTransfers, getLatestBlockNumber, getConfirmations } from '../payments/monitor.js';
import { activatePayment } from '../payments/activate.js';
import { config } from '../config.js';

const router = express.Router();

router.get('/invoices', authRequired, (req, res) => {
  const rows = getPaymentsByUser(req.user.id);
  res.json({ invoices: rows.map((r) => ({
    id: r.id,
    code: r.invoice_code,
    network: r.network,
    toAddress: r.to_address,
    amountUsd: r.amount_usd,
    plan: r.plan,
    status: r.status,
    txHash: r.tx_hash,
    confirmations: r.confirmations,
    createdAt: r.created_at,
    paidAt: r.paid_at,
  })) });
});

router.get('/status', authRequired, (req, res) => {
  const user = getUserById(req.user.id);
  res.json({ plan: isPro(user) ? 'pro' : 'free', planExpiresAt: user.plan_expires_at });
});

// Manual confirmation: the user submits their TX hash (TXID) after sending USDT.
// We look the transaction up on the chain immediately (no waiting for the 60s sweep).
router.post('/verify', authRequired, async (req, res) => {
  const { invoiceCode, txHash } = req.body || {};
  if (!invoiceCode || !txHash) {
    return res.status(400).json({ error: 'invoiceCode and txHash are required' });
  }

  const rows = getPaymentsByUser(req.user.id);
  const inv = rows.find((p) => String(p.invoice_code).toLowerCase() === String(invoiceCode).toLowerCase())
    || rows.find((p) => String(p.id) === String(invoiceCode));
  if (!inv) return res.status(404).json({ error: 'Invoice not found' });
  if (inv.status === 'paid') {
    return res.json({ found: true, verified: true, alreadyPaid: true, plan: 'pro', expiresAt: req.user.plan_expires_at });
  }

  const net = inv.network;
  let txs = [];
  try {
    txs = net === 'BEP-20' ? await fetchBscTransfers(inv.to_address) : await fetchTronTransfers(inv.to_address);
  } catch (_e) {
    return res.json({ found: false, message: 'We could not reach the blockchain right now. The automatic monitor will keep checking for you.' });
  }

  const tx = txs.find((t) => t.tx_hash && t.tx_hash.toLowerCase() === String(txHash).toLowerCase());
  if (!tx) {
    return res.json({ found: false, message: 'This transaction was not found on the network yet. Double-check the TX hash and network, or wait a minute and try again.' });
  }

  const paid = Math.abs(tx.amount || 0);
  if (paid < inv.amount_usd * 0.98) {
    return res.json({ found: true, verified: false, reason: `We received ${paid} USDT but the invoice is for ${inv.amount_usd} USDT. The amount does not match.` });
  }

  const required = net === 'TRC-20' ? config.usdt.confirmationsTron : config.usdt.confirmationsBsc;
  let confs = 1;
  try {
    const tip = await getLatestBlockNumber(net);
    confs = getConfirmations(tip, tx.blockNumber);
  } catch (_e) { /* keep opt-in behavior on block lookup failure */ }

  if (confs < required) {
    updatePaymentStatus(inv.id, { confirmations: confs, tx_hash: tx.tx_hash, tx_amount: paid });
    return res.json({ found: true, verified: false, confirmations: confs, required, message: `Payment detected! Waiting for confirmations (${confs}/${required}).` });
  }

  const result = activatePayment(inv, { confirmations: confs, txHash: tx.tx_hash, amount: paid });
  res.json({ found: true, verified: true, plan: 'pro', expiresAt: result.expiresAt, message: 'Payment confirmed — your PRO is now active!' });
});

export default router;
