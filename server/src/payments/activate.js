import { getUserById, updatePaymentStatus, updateUserPlan } from '../db.js';

// Mark a confirmed payment as paid and (re)activate PRO with stacked duration.
// The new expiry extends from the user's CURRENT expiry (if still active) so a
// renewal never shortens the time they already paid for; otherwise it starts now.
export async function activatePayment(payment, { confirmations = 1, txHash = payment.tx_hash, amount = payment.tx_amount } = {}) {
  const now = Date.now();
  const user = await getUserById(payment.user_id);

  let base = now;
  if (user && user.plan === 'pro' && user.plan_expires_at && user.plan_expires_at > now) {
    base = user.plan_expires_at; // stack on top of remaining period
  }
  const durationMs = (payment.duration_days || 0) * 86400000;
  const expiresAt = base + durationMs;

  await updatePaymentStatus(payment.id, {
    status: 'paid',
    tx_hash: txHash || payment.tx_hash || null,
    tx_amount: amount ?? payment.tx_amount ?? null,
    confirmations: confirmations || 1,
    paid_at: now,
  });

  if (user) {
    await updateUserPlan(user.id, 'pro', expiresAt);
    console.log(`[payment] user ${user.id} PRO until ${new Date(expiresAt).toISOString()} (invoice ${payment.invoice_code}, +${payment.duration_days || 0}d)`);
  }

  return { expiresAt, user };
}