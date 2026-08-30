// Integration tests for the Supabase (Postgres) backend.
// Run: SUPABASE_DB_URL=postgres://... node --test test/supabase.test.js
//
// Skipped automatically if SUPABASE_DB_URL is not set, so the regular
// `npm test` run still works on hosts without network/db credentials.
//
// Every test uses a unique email tagged with the run timestamp, so reruns
// do not collide and the test never touches a real user's row.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';

const url = process.env.SUPABASE_DB_URL;
if (!url) {
  // node:test still requires at least one test to mark the file as run;
  // we emit a single skipped entry instead of a hard fail so CI doesn't
  // turn red on a developer laptop with no Supabase credentials.
  test('supabase backend (skipped — SUPABASE_DB_URL not set)', { skip: true }, () => {});
} else {
  // Load the module fresh so each process gets a clean pool.
  const dbUrl = url + (url.includes('?') ? '&' : '?') + 'application_name=arbihunt_test';
  process.env.SUPABASE_DB_URL = dbUrl;
  const db = await import('../src/db.supabase.js?v=' + Date.now());

  // Make sure the schema is bootstrapped before anything else.
  await db.initSchema();

  const runId = Date.now().toString(36) + '-' + randomBytes(2).toString('hex');
  const testEmail = `test-${runId}@arbihunt.test`;
  const testEmail2 = `test2-${runId}@arbihunt.test`;

  test('ping() returns true after init', async () => {
    const ok = await db.ping();
    assert.equal(ok, true);
  });

  let createdUser = null;
  test('createUser inserts and returns a user with referral_code', async () => {
    const u = await db.createUser({
      email: testEmail,
      passwordHash: 'hash-not-real',
      referredBy: null,
    });
    assert.ok(u, 'user returned');
    assert.equal(u.email, testEmail);
    assert.equal(u.plan, 'free');
    assert.ok(u.referral_code && u.referral_code.length > 0, 'referral code present');
    createdUser = u;
  });

  test('getUserByEmail finds the user we just created', async () => {
    const u = await db.getUserByEmail(testEmail);
    assert.ok(u, 'user found');
    assert.equal(u.id, createdUser.id);
  });

  test('getUserById returns the same row', async () => {
    const u = await db.getUserById(createdUser.id);
    assert.equal(u.email, testEmail);
  });

  test('isPro is a pure helper', () => {
    assert.equal(db.isPro({ plan: 'free' }), false);
    assert.equal(db.isPro({ plan: 'pro', plan_expires_at: null }), true);
    assert.equal(db.isPro({ plan: 'pro', plan_expires_at: Date.now() - 1 }), false);
    assert.equal(db.isPro({ plan: 'pro', plan_expires_at: Date.now() + 60_000 }), true);
    assert.equal(db.isPro(null), false);
  });

  test('updateUserPlan flips plan and persists expiresAt', async () => {
    const expires = Date.now() + 7 * 86400000;
    const updated = await db.updateUserPlan(createdUser.id, 'pro', expires);
    assert.equal(updated.plan, 'pro');
    assert.equal(updated.plan_expires_at, expires);
    // confirm via a fresh read
    const fresh = await db.getUserById(createdUser.id);
    assert.equal(fresh.plan, 'pro');
  });

  test('listUsers returns an array including our test user', async () => {
    const users = await db.listUsers();
    assert.ok(Array.isArray(users));
    const found = users.find((u) => u.email === testEmail);
    assert.ok(found, 'our test user should appear in the list');
  });

  test('getUserCounts reports at least the test users we created', async () => {
    const counts = await db.getUserCounts();
    assert.ok(typeof counts.total === 'number' && counts.total > 0);
    assert.ok(typeof counts.pro === 'number' && counts.pro >= 0);
  });

  test('setPasswordReset + getUserByResetCode round-trip', async () => {
    const code = 'ABCD';
    const expires = Date.now() + 15 * 60 * 1000;
    const ok = await db.setPasswordReset(testEmail, code, expires);
    assert.equal(ok, true);
    const found = await db.getUserByResetCode(code);
    assert.ok(found, 'user found by reset code');
    assert.equal(found.id, createdUser.id);
    // clear it so we don't leave reset codes lingering
    await db.clearPasswordReset(testEmail);
    const after = await db.getUserByResetCode(code);
    assert.equal(after, null);
  });

  test('resetUserPassword updates the hash', async () => {
    const ok = await db.resetUserPassword(testEmail, 'new-hash-xyz');
    assert.equal(ok, true);
    const fresh = await db.getUserByEmail(testEmail);
    assert.equal(fresh.password_hash, 'new-hash-xyz');
  });

  test('watchlist add/list/remove', async () => {
    const sym1 = `BTC-${runId}`;
    const sym2 = `ETH-${runId}`;
    const added1 = await db.addWatchlist(createdUser.id, sym1);
    assert.ok(added1, 'first add returns row');
    const addedAgain = await db.addWatchlist(createdUser.id, sym1);
    assert.equal(addedAgain, null, 'duplicate add returns null');
    await db.addWatchlist(createdUser.id, sym2);
    const list = await db.getWatchlist(createdUser.id);
    const symbols = list.map((r) => r.symbol);
    assert.ok(symbols.includes(sym1));
    assert.ok(symbols.includes(sym2));
    await db.removeWatchlist(createdUser.id, sym1);
    const after = await db.getWatchlist(createdUser.id);
    assert.ok(!after.map((r) => r.symbol).includes(sym1));
  });

  test('payments: create + list + status update', async () => {
    const p = await db.createPayment({
      userId: createdUser.id,
      invoiceCode: `INV-${runId}`,
      network: 'TRC-20',
      toAddress: 'TXXX',
      amountUsd: 7,
      plan: '1-month',
      durationDays: 30,
    });
    assert.equal(p.status, 'pending');
    const list = await db.getPaymentsByUser(createdUser.id);
    const found = list.find((r) => r.invoice_code === p.invoice_code);
    assert.ok(found, 'payment listed under user');
    // pending list should include it
    const pending = await db.getPendingPayments();
    assert.ok(pending.find((r) => r.id === p.id), 'pending list contains it');
    // flip to paid
    const ok = await db.updatePaymentStatus(p.id, {
      status: 'paid',
      tx_hash: '0xdeadbeef',
      tx_amount: 7,
      confirmations: 19,
      paid_at: Date.now(),
    });
    assert.equal(ok, true);
    const list2 = await db.getPaymentsByUser(createdUser.id);
    const after = list2.find((r) => r.id === p.id);
    assert.equal(after.status, 'paid');
    assert.equal(after.tx_hash, '0xdeadbeef');
    // pending list should NOT include it anymore
    const pending2 = await db.getPendingPayments();
    assert.ok(!pending2.find((r) => r.id === p.id), 'no longer pending');
  });

  test('exchanges_cache: write and read back the same JSON', async () => {
    const exId = `test-exchange-${runId}`;
    const payload = [{ symbol: 'BTC/USDT', base: 'BTC' }, { symbol: 'ETH/USDT', base: 'ETH' }];
    await db.cacheMarkets(exId, payload);
    const back = await db.getCachedMarkets(exId);
    assert.deepEqual(back, payload);
    // overwriting replaces, not appends
    const next = [{ symbol: 'SOL/USDT', base: 'SOL' }];
    await db.cacheMarkets(exId, next);
    const back2 = await db.getCachedMarkets(exId);
    assert.deepEqual(back2, next);
  });

  test('addScanHistory is fire-and-forget and does not throw', async () => {
    await db.addScanHistory(12, 1500, 6);
    // no return to assert — we only verify the call resolves.
    assert.ok(true);
  });

  // --- cleanup ---------------------------------------------------------
  // Drop the test user's payments + watchlist + the user row so the
  // integration test does not pollute the production schema. We use
  // a small raw SQL helper because the public module does not expose
  // a deleteUser function (rightly so — auth is the only place that
  // should be able to delete users).
  test('cleanup: remove test user and all related rows', async () => {
    const { default: pg } = await import('pg');
    const pool = new pg.Pool({ connectionString: dbUrl });
    try {
      await pool.query('DELETE FROM watchlist WHERE user_id IN (SELECT id FROM users WHERE email IN ($1, $2))', [testEmail, testEmail2]);
      await pool.query('DELETE FROM payments WHERE user_id IN (SELECT id FROM users WHERE email IN ($1, $2))', [testEmail, testEmail2]);
      await pool.query('DELETE FROM users WHERE email IN ($1, $2)', [testEmail, testEmail2]);
      await pool.query("DELETE FROM exchanges_cache WHERE exchange LIKE 'test-exchange-%'");
    } finally {
      await pool.end();
    }
    const after = await db.getUserByEmail(testEmail);
    assert.equal(after, null, 'test user gone');
  });

  test('close() ends the pool cleanly', async () => {
    await db.close();
    assert.ok(true);
  });
}
