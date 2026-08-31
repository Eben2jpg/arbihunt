// Supabase (Postgres) backend for db.js. Selected when SUPABASE_DB_URL
// is set. Mirrors the function surface of db.json.js and db.sqlite.js
// but every function that touches storage is async and returns a
// Promise — call sites must `await`.
//
// On boot we (1) open a pg.Pool, (2) run the schema with
// CREATE TABLE IF NOT EXISTS so the deploy is zero-touch, and
// (3) log the active backend. The pool is shared across requests via
// node-postgres' default behavior; no per-request connect cost.
//
// Table names mirror the SQLite schema. `isPro` is a pure helper that
// takes a user object and does not query the DB; it is also re-exported
// from db.js selectors unchanged.

import pg from 'pg';

const { Pool } = pg;

const connectionString = process.env.SUPABASE_DB_URL;
if (!connectionString) {
  throw new Error('db.supabase.js loaded but SUPABASE_DB_URL is not set');
}

// Disable the native pg_types parser for bigints — we don't use bigint
// columns; everything is INTEGER (4 bytes) and serialised as JS Number.
pg.types.setTypeParser(20, (val) => (val == null ? null : Number(val)));
pg.types.setTypeParser(1114, (val) => val); // keep timestamps as strings

const pool = new Pool({
  connectionString,
  // Keep idle connections alive so the pool doesn't reset every request
  // through the Supabase pooler. max 10 is plenty for one Node process.
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 8_000,
  // Force IPv4. Render's free-tier network has no IPv6 route to
  // Supabase's direct-connection host, and node-postgres prefers
  // IPv6 when DNS returns both A and AAAA records — which would
  // leave us with ENETUNREACH. Pinning to 4 makes it skip AAAA
  // and use the A record.
  family: 4,
});

pool.on('error', (e) => console.warn('[db:supabase] idle client error:', e.message));

// --- Schema bootstrap (idempotent) -----------------------------------------

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS users (
  id BIGSERIAL PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  plan TEXT NOT NULL DEFAULT 'free',
  plan_expires_at BIGINT,
  referral_code TEXT,
  referred_by TEXT,
  reset_code TEXT,
  reset_expires_at BIGINT,
  created_at BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS watchlist (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  symbol TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  UNIQUE(user_id, symbol)
);
CREATE TABLE IF NOT EXISTS payments (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  invoice_code TEXT,
  network TEXT,
  to_address TEXT,
  amount_usd DOUBLE PRECISION,
  plan TEXT,
  duration_days INTEGER,
  status TEXT NOT NULL DEFAULT 'pending',
  tx_hash TEXT,
  tx_amount DOUBLE PRECISION,
  confirmations INTEGER DEFAULT 0,
  paid_at BIGINT,
  created_at BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS exchanges_cache (
  exchange TEXT PRIMARY KEY,
  markets_json TEXT NOT NULL,
  updated_at BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS scan_history (
  id BIGSERIAL PRIMARY KEY,
  scanned_at BIGINT NOT NULL,
  opportunities INTEGER NOT NULL,
  duration_ms INTEGER NOT NULL,
  exchanges INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_payments_user ON payments(user_id);
CREATE INDEX IF NOT EXISTS idx_payments_status ON payments(status);
CREATE INDEX IF NOT EXISTS idx_watchlist_user ON watchlist(user_id);
`;

export async function initSchema() {
  // Run as one multi-statement query. node-postgres supports this when
  // simple-query mode is enabled; we use the dedicated `query` call
  // with multiple statements separated by semicolons, which pg supports
  // out of the box.
  await pool.query(SCHEMA_SQL);
  console.log('[db:supabase] schema ready');
}

// --- row -> object shaping --------------------------------------------------

function rowToUser(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    email: row.email,
    password_hash: row.password_hash,
    plan: row.plan,
    plan_expires_at: row.plan_expires_at == null ? null : Number(row.plan_expires_at),
    referral_code: row.referral_code,
    referred_by: row.referred_by,
    reset_code: row.reset_code,
    reset_expires_at: row.reset_expires_at == null ? null : Number(row.reset_expires_at),
    created_at: Number(row.created_at),
  };
}

// `isPro` is a pure helper. Same signature as the SQLite/JSON backends so
// call sites don't have to change.
export function isPro(user) {
  return user && user.plan === 'pro' && (user.plan_expires_at == null || user.plan_expires_at > Date.now());
}

// --- users ------------------------------------------------------------------

export async function getUserById(id) {
  const { rows } = await pool.query('SELECT * FROM users WHERE id = $1', [id]);
  return rowToUser(rows[0]);
}

export async function getUserByEmail(email) {
  const { rows } = await pool.query('SELECT * FROM users WHERE email = $1', [String(email).toLowerCase()]);
  return rowToUser(rows[0]);
}

export async function createUser({ email, passwordHash, referredBy }) {
  const e = String(email).toLowerCase();
  // Referral code: 8 chars from the local-part + 4 random hex.
  const local = e.split('@')[0].replace(/[^a-zA-Z0-9]/g, '').toUpperCase().slice(0, 8);
  const tail = Math.floor(Math.random() * 0xffff).toString(16).toUpperCase().padStart(4, '0');
  const referral = (local + tail).slice(0, 12);
  const { rows } = await pool.query(
    `INSERT INTO users (email, password_hash, plan, referral_code, referred_by, created_at)
     VALUES ($1, $2, 'free', $3, $4, $5)
     RETURNING *`,
    [e, passwordHash, referral, referredBy || null, Date.now()]
  );
  return rowToUser(rows[0]);
}

export async function getUserCounts() {
  const { rows: totalRows } = await pool.query('SELECT COUNT(*)::int AS c FROM users');
  const now = Date.now();
  const { rows: proRows } = await pool.query(
    "SELECT COUNT(*)::int AS c FROM users WHERE plan = 'pro' AND (plan_expires_at IS NULL OR plan_expires_at > $1)",
    [now]
  );
  return { total: totalRows[0].c, pro: proRows[0].c };
}

export async function listUsers() {
  const { rows } = await pool.query('SELECT * FROM users ORDER BY created_at DESC');
  return rows.map((r) => ({
    id: Number(r.id),
    email: r.email,
    plan: r.plan,
    planExpiresAt: r.plan_expires_at == null ? null : Number(r.plan_expires_at),
    referralCode: r.referral_code,
    createdAt: Number(r.created_at),
  }));
}

export async function updateUserPlan(userId, plan, expiresAt) {
  await pool.query('UPDATE users SET plan = $1, plan_expires_at = $2 WHERE id = $3', [plan, expiresAt, userId]);
  return getUserById(userId);
}

export async function resetUserPassword(email, passwordHash) {
  const e = String(email).toLowerCase();
  const { rowCount } = await pool.query('UPDATE users SET password_hash = $1 WHERE email = $2', [passwordHash, e]);
  return rowCount > 0;
}

export async function setPasswordReset(email, code, expiresAt) {
  const e = String(email).toLowerCase();
  const { rowCount } = await pool.query(
    'UPDATE users SET reset_code = $1, reset_expires_at = $2 WHERE email = $3',
    [code, expiresAt, e]
  );
  return rowCount > 0;
}

export async function getUserByResetCode(code) {
  const { rows } = await pool.query(
    'SELECT * FROM users WHERE reset_code = $1 AND reset_expires_at > $2',
    [code, Date.now()]
  );
  return rowToUser(rows[0]);
}

export async function clearPasswordReset(email) {
  const e = String(email).toLowerCase();
  await pool.query('UPDATE users SET reset_code = NULL, reset_expires_at = NULL WHERE email = $1', [e]);
}

// --- watchlist --------------------------------------------------------------

export async function getWatchlist(userId) {
  const { rows } = await pool.query(
    'SELECT * FROM watchlist WHERE user_id = $1 ORDER BY created_at DESC',
    [userId]
  );
  return rows.map((r) => ({
    id: Number(r.id),
    user_id: Number(r.user_id),
    symbol: r.symbol,
    created_at: Number(r.created_at),
  }));
}

export async function addWatchlist(userId, symbol) {
  const sym = String(symbol).toUpperCase();
  const { rowCount } = await pool.query(
    'INSERT INTO watchlist (user_id, symbol, created_at) VALUES ($1, $2, $3) ON CONFLICT (user_id, symbol) DO NOTHING',
    [userId, sym, Date.now()]
  );
  if (rowCount === 0) return null;
  const { rows } = await pool.query(
    'SELECT * FROM watchlist WHERE user_id = $1 AND symbol = $2',
    [userId, sym]
  );
  return rows[0] ? { id: Number(rows[0].id), user_id: Number(rows[0].user_id), symbol: rows[0].symbol, created_at: Number(rows[0].created_at) } : null;
}

export async function removeWatchlist(userId, symbol) {
  const sym = String(symbol).toUpperCase();
  await pool.query('DELETE FROM watchlist WHERE user_id = $1 AND symbol = $2', [userId, sym]);
}

// --- payments ---------------------------------------------------------------

export async function createPayment({ userId, invoiceCode, network, toAddress, amountUsd, plan, durationDays }) {
  const { rows } = await pool.query(
    `INSERT INTO payments (user_id, invoice_code, network, to_address, amount_usd, plan, duration_days, status, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending', $8)
     RETURNING *`,
    [userId, invoiceCode || null, network || null, toAddress || null, amountUsd, plan || null, durationDays || null, Date.now()]
  );
  const r = rows[0];
  return {
    id: Number(r.id),
    user_id: Number(r.user_id),
    invoice_code: r.invoice_code,
    network: r.network,
    to_address: r.to_address,
    amount_usd: r.amount_usd,
    plan: r.plan,
    duration_days: r.duration_days,
    status: r.status,
    tx_hash: r.tx_hash,
    tx_amount: r.tx_amount,
    confirmations: r.confirmations,
    paid_at: r.paid_at == null ? null : Number(r.paid_at),
    created_at: Number(r.created_at),
  };
}

export async function getPaymentsByUser(userId) {
  const { rows } = await pool.query(
    'SELECT * FROM payments WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50',
    [userId]
  );
  return rows.map((r) => ({
    id: Number(r.id),
    user_id: Number(r.user_id),
    invoice_code: r.invoice_code,
    network: r.network,
    to_address: r.to_address,
    amount_usd: r.amount_usd,
    plan: r.plan,
    duration_days: r.duration_days,
    status: r.status,
    tx_hash: r.tx_hash,
    tx_amount: r.tx_amount,
    confirmations: r.confirmations,
    paid_at: r.paid_at == null ? null : Number(r.paid_at),
    created_at: Number(r.created_at),
  }));
}

export async function getPendingPayments() {
  const { rows } = await pool.query("SELECT * FROM payments WHERE status = 'pending' ORDER BY created_at ASC");
  return rows.map((r) => ({
    id: Number(r.id),
    user_id: Number(r.user_id),
    invoice_code: r.invoice_code,
    network: r.network,
    to_address: r.to_address,
    amount_usd: r.amount_usd,
    plan: r.plan,
    duration_days: r.duration_days,
    status: r.status,
    tx_hash: r.tx_hash,
    tx_amount: r.tx_amount,
    confirmations: r.confirmations,
    paid_at: r.paid_at == null ? null : Number(r.paid_at),
    created_at: Number(r.created_at),
  }));
}

export async function updatePaymentStatus(id, updates) {
  // COALESCE pattern so we can update individual fields.
  const { tx_hash, tx_amount, confirmations, status, paid_at } = updates || {};
  const { rowCount } = await pool.query(
    `UPDATE payments SET
       status     = COALESCE($1, status),
       tx_hash    = COALESCE($2, tx_hash),
       tx_amount  = COALESCE($3, tx_amount),
       confirmations = COALESCE($4, confirmations),
       paid_at    = COALESCE($5, paid_at)
     WHERE id = $6`,
    [status ?? null, tx_hash ?? null, tx_amount ?? null, confirmations ?? null, paid_at ?? null, id]
  );
  return rowCount > 0;
}

// --- exchanges_cache --------------------------------------------------------

export async function cacheMarkets(exchangeId, markets) {
  const json = JSON.stringify(markets);
  const ts = Date.now();
  await pool.query(
    `INSERT INTO exchanges_cache (exchange, markets_json, updated_at)
     VALUES ($1, $2, $3)
     ON CONFLICT (exchange) DO UPDATE SET markets_json = EXCLUDED.markets_json, updated_at = EXCLUDED.updated_at`,
    [exchangeId, json, ts]
  );
}

export async function getCachedMarkets(exchangeId) {
  const { rows } = await pool.query('SELECT * FROM exchanges_cache WHERE exchange = $1', [exchangeId]);
  if (!rows[0]) return null;
  try { return JSON.parse(rows[0].markets_json); } catch (_) { return null; }
}

// --- scan_history -----------------------------------------------------------

export async function addScanHistory(opportunities, durationMs, exchangesCount) {
  await pool.query(
    'INSERT INTO scan_history (scanned_at, opportunities, duration_ms, exchanges) VALUES ($1, $2, $3, $4)',
    [Date.now(), opportunities, durationMs, exchangesCount]
  );
  // Prune to last 500 rows to match the SQLite behaviour.
  await pool.query('DELETE FROM scan_history WHERE id NOT IN (SELECT id FROM scan_history ORDER BY id DESC LIMIT 500)');
}

// --- health check used by the boot sequence --------------------------------

export async function ping() {
  const { rows } = await pool.query('SELECT 1 AS ok');
  return rows[0].ok === 1;
}

export async function close() {
  await pool.end();
}
