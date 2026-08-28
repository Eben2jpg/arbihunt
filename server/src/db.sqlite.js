// SQLite implementation. Imported by db.js when better-sqlite3 is available.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import Database from 'better-sqlite3';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Honor DB_PATH so production deploys can point at a persistent volume
// (Render disk mounted at /data, etc.). Falls back to the local data/
// folder for development.
const DB_PATH = process.env.DB_PATH
  ? path.resolve(process.env.DB_PATH)
  : path.join(__dirname, '../data/arbihunt.db');
const LEGACY_JSON = process.env.DB_PATH
  ? path.join(path.dirname(DB_PATH), 'db.json')
  : path.join(__dirname, '../data/db.json');

function ensureDir() {
  const dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  plan TEXT NOT NULL DEFAULT 'free',
  plan_expires_at INTEGER,
  referral_code TEXT,
  referred_by TEXT,
  reset_code TEXT,
  reset_expires_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS watchlist (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL,
  symbol TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE(user_id, symbol)
);
CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL,
  invoice_code TEXT,
  network TEXT,
  to_address TEXT,
  amount_usd REAL,
  plan TEXT,
  duration_days INTEGER,
  status TEXT NOT NULL DEFAULT 'pending',
  tx_hash TEXT,
  tx_amount REAL,
  confirmations INTEGER DEFAULT 0,
  paid_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS exchanges_cache (
  exchange TEXT PRIMARY KEY,
  markets_json TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS scan_history (
  id INTEGER PRIMARY KEY,
  scanned_at INTEGER NOT NULL,
  opportunities INTEGER NOT NULL,
  duration_ms INTEGER NOT NULL,
  exchanges INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_payments_user ON payments(user_id);
CREATE INDEX IF NOT EXISTS idx_payments_status ON payments(status);
CREATE INDEX IF NOT EXISTS idx_watchlist_user ON watchlist(user_id);
`);

function importLegacyIfPresent() {
  if (!fs.existsSync(LEGACY_JSON)) return;
  const flag = LEGACY_JSON + '.imported';
  if (fs.existsSync(flag)) return;
  let raw;
  try { raw = JSON.parse(fs.readFileSync(LEGACY_JSON, 'utf8')); }
  catch (_e) { fs.renameSync(LEGACY_JSON, flag); return; }
  const tx = db.transaction(() => {
    for (const u of (raw.users || [])) {
      db.prepare(`INSERT OR IGNORE INTO users
        (id, email, password_hash, plan, plan_expires_at, referral_code, referred_by, reset_code, reset_expires_at, created_at)
        VALUES (?,?,?,?,?,?,?,?,?,?)`).run(
        u.id, u.email, u.password_hash, u.plan || 'free', u.plan_expires_at || null,
        u.referral_code || null, u.referred_by || null, u.reset_code || null,
        u.reset_expires_at || null, u.created_at || Date.now()
      );
    }
    for (const w of (raw.watchlist || [])) {
      db.prepare(`INSERT OR IGNORE INTO watchlist (id, user_id, symbol, created_at) VALUES (?,?,?,?)`)
        .run(w.id, w.user_id, w.symbol, w.created_at || Date.now());
    }
    for (const p of (raw.payments || [])) {
      db.prepare(`INSERT OR IGNORE INTO payments
        (id, user_id, invoice_code, network, to_address, amount_usd, plan, duration_days,
         status, tx_hash, tx_amount, confirmations, paid_at, created_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
        p.id, p.user_id, p.invoice_code || null, p.network || null, p.to_address || null,
        p.amount_usd || null, p.plan || null, p.duration_days || null,
        p.status || 'pending', p.tx_hash || null, p.tx_amount || null,
        p.confirmations || 0, p.paid_at || null, p.created_at || Date.now()
      );
    }
    for (const e of (raw.exchanges_cache || [])) {
      db.prepare(`INSERT OR REPLACE INTO exchanges_cache (exchange, markets_json, updated_at) VALUES (?,?,?)`)
        .run(e.exchange, e.markets_json, e.updated_at || Date.now());
    }
    for (const s of (raw.scan_history || [])) {
      db.prepare(`INSERT OR IGNORE INTO scan_history (id, scanned_at, opportunities, duration_ms, exchanges) VALUES (?,?,?,?,?)`)
        .run(s.id, s.scanned_at, s.opportunities || 0, s.duration_ms || 0, s.exchanges || 0);
    }
  });
  try { tx(); fs.renameSync(LEGACY_JSON, flag); console.log('[db] imported legacy db.json -> SQLite'); }
  catch (e) { console.warn('[db] legacy import failed:', e.message); }
}
ensureDir();
importLegacyIfPresent();

const stmts = {
  getUserById: db.prepare('SELECT * FROM users WHERE id = ?'),
  getUserByEmail: db.prepare('SELECT * FROM users WHERE email = ?'),
  insertUser: db.prepare(`INSERT INTO users
    (email, password_hash, plan, plan_expires_at, referral_code, referred_by, created_at)
    VALUES (?,?,?,?,?,?,?)`),
  getWatchlist: db.prepare('SELECT * FROM watchlist WHERE user_id = ? ORDER BY created_at DESC'),
  insertWatchlist: db.prepare('INSERT INTO watchlist (user_id, symbol, created_at) VALUES (?,?,?)'),
  findWatchlist: db.prepare('SELECT * FROM watchlist WHERE user_id = ? AND symbol = ?'),
  deleteWatchlist: db.prepare('DELETE FROM watchlist WHERE user_id = ? AND symbol = ?'),
  insertPayment: db.prepare(`INSERT INTO payments
    (user_id, invoice_code, network, to_address, amount_usd, plan, duration_days, status, created_at)
    VALUES (?,?,?,?,?,?,?,?,?)`),
  paymentsByUser: db.prepare('SELECT * FROM payments WHERE user_id = ? ORDER BY created_at DESC LIMIT 50'),
  pendingPayments: db.prepare("SELECT * FROM payments WHERE status = 'pending'"),
  updatePayment: db.prepare(`UPDATE payments SET
    status = COALESCE(?, status),
    tx_hash = COALESCE(?, tx_hash),
    tx_amount = COALESCE(?, tx_amount),
    confirmations = COALESCE(?, confirmations),
    paid_at = COALESCE(?, paid_at)
    WHERE id = ?`),
  updateUserPlan: db.prepare('UPDATE users SET plan = ?, plan_expires_at = ? WHERE id = ?'),
  setReset: db.prepare('UPDATE users SET reset_code = ?, reset_expires_at = ? WHERE email = ?'),
  clearReset: db.prepare('UPDATE users SET reset_code = NULL, reset_expires_at = NULL WHERE email = ?'),
  resetPassword: db.prepare('UPDATE users SET password_hash = ? WHERE email = ?'),
  userCount: db.prepare('SELECT COUNT(*) AS c FROM users'),
  proCount: db.prepare("SELECT COUNT(*) AS c FROM users WHERE plan = 'pro' AND (plan_expires_at IS NULL OR plan_expires_at > ?)"),
  cacheMarketsGet: db.prepare('SELECT * FROM exchanges_cache WHERE exchange = ?'),
  cacheMarketsPut: db.prepare(`INSERT INTO exchanges_cache (exchange, markets_json, updated_at) VALUES (?,?,?)
    ON CONFLICT(exchange) DO UPDATE SET markets_json = excluded.markets_json, updated_at = excluded.updated_at`),
  insertScanHistory: db.prepare(`INSERT INTO scan_history (scanned_at, opportunities, duration_ms, exchanges) VALUES (?,?,?,?)`),
  pruneScanHistory: db.prepare(`DELETE FROM scan_history WHERE id NOT IN (SELECT id FROM scan_history ORDER BY id DESC LIMIT 500)`),
};

function rowToUser(row) {
  if (!row) return null;
  return {
    id: row.id, email: row.email, password_hash: row.password_hash,
    plan: row.plan, plan_expires_at: row.plan_expires_at,
    referral_code: row.referral_code, referred_by: row.referred_by,
    reset_code: row.reset_code, reset_expires_at: row.reset_expires_at,
    created_at: row.created_at,
  };
}

export function getUserById(id) { return rowToUser(stmts.getUserById.get(id)); }
export function getUserByEmail(email) { return rowToUser(stmts.getUserByEmail.get(email)); }

export function getUserCounts() {
  const total = stmts.userCount.get().c;
  const pro = stmts.proCount.get(Date.now()).c;
  return { total, pro };
}

export function listUsers() {
  const rows = db.prepare('SELECT * FROM users ORDER BY created_at DESC').all();
  return rows.map((u) => ({
    id: u.id, email: u.email, plan: u.plan,
    planExpiresAt: u.plan_expires_at, referralCode: u.referral_code,
    createdAt: u.created_at,
  }));
}

export function createUser({ email, passwordHash, referredBy }) {
  const referral = email.split('@')[0].replace(/[^a-zA-Z0-9]/g, '').toUpperCase().slice(0, 8) +
    crypto.randomBytes(2).toString('hex').toUpperCase();
  const info = stmts.insertUser.run(
    email, passwordHash, 'free', null, referral, referredBy || null, Date.now()
  );
  return getUserById(info.lastInsertRowid);
}

export function isPro(user) {
  return user.plan === 'pro' && (user.plan_expires_at == null || user.plan_expires_at > Date.now());
}

export function getWatchlist(userId) { return stmts.getWatchlist.all(userId); }
export function addWatchlist(userId, symbol) {
  const sym = symbol.toUpperCase();
  if (stmts.findWatchlist.get(userId, sym)) return null;
  const info = stmts.insertWatchlist.run(userId, sym, Date.now());
  return { id: info.lastInsertRowid, user_id: userId, symbol: sym, created_at: Date.now() };
}
export function removeWatchlist(userId, symbol) {
  stmts.deleteWatchlist.run(userId, symbol.toUpperCase());
}

export function createPayment({ userId, invoiceCode, network, toAddress, amountUsd, plan, durationDays }) {
  const info = stmts.insertPayment.run(
    userId, invoiceCode, network, toAddress, amountUsd, plan, durationDays,
    'pending', Date.now()
  );
  return { id: info.lastInsertRowid, user_id: userId, invoice_code: invoiceCode, network,
           to_address: toAddress, amount_usd: amountUsd, plan, duration_days: durationDays,
           status: 'pending', tx_hash: null, tx_amount: null, confirmations: 0,
           created_at: Date.now(), paid_at: null };
}
export function getPaymentsByUser(userId) { return stmts.paymentsByUser.all(userId); }
export function getPendingPayments() { return stmts.pendingPayments.all(); }
export function updatePaymentStatus(id, updates) {
  stmts.updatePayment.run(
    updates.status ?? null, updates.tx_hash ?? null, updates.tx_amount ?? null,
    updates.confirmations ?? null, updates.paid_at ?? null, id
  );
  return db.prepare('SELECT * FROM payments WHERE id = ?').get(id);
}
export function updateUserPlan(userId, plan, expiresAt) {
  stmts.updateUserPlan.run(plan, expiresAt, userId);
  return getUserById(userId);
}
export function resetUserPassword(email, passwordHash) {
  stmts.resetPassword.run(passwordHash, email);
  return getUserByEmail(email);
}
export function setPasswordReset(email, code, expiresAt) {
  stmts.setReset.run(code, expiresAt, email);
  return getUserByEmail(email);
}
export function getUserByResetCode(code) {
  const row = db.prepare('SELECT * FROM users WHERE reset_code = ? AND reset_expires_at IS NOT NULL AND reset_expires_at > ?').get(code, Date.now());
  return rowToUser(row);
}
export function clearPasswordReset(email) {
  stmts.clearReset.run(email);
  return getUserByEmail(email);
}
export function cacheMarkets(exchangeId, markets) {
  stmts.cacheMarketsPut.run(exchangeId, JSON.stringify(markets), Date.now());
}
export function getCachedMarkets(exchangeId) {
  const row = stmts.cacheMarketsGet.get(exchangeId);
  return row ? JSON.parse(row.markets_json) : null;
}
export function addScanHistory(opportunities, durationMs, exchangesCount) {
  stmts.insertScanHistory.run(Date.now(), opportunities, durationMs, exchangesCount);
  stmts.pruneScanHistory.run();
}
