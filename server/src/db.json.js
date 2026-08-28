// JSON-file fallback for db.js. Activated automatically when the native
// better-sqlite3 binding cannot be loaded (e.g. no MSVC toolchain on Windows).
// Same exports and behaviour as the previous JSON store. The first call writes
// a fresh data/db.json; if a SQLite db.js is later available, it will auto-
// import this file on its next boot and rename it to .imported.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Honor DB_PATH so production deploys can point at a persistent volume.
// On Render the disk is mounted at /data, so set DB_PATH=/data/db.json.
const DB_FILE = process.env.DB_PATH
  ? path.resolve(process.env.DB_PATH)
  : path.join(__dirname, '../data/db.json');

function read() {
  try {
    if (!fs.existsSync(DB_FILE)) return init();
    return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  } catch (e) { return init(); }
}
function write(data) {
  const dir = path.dirname(DB_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}
function init() {
  const data = { users: [], watchlist: [], payments: [], exchanges_cache: [], scan_history: [] };
  write(data);
  return data;
}

// IMPORTANT: every read re-parses the file. The previous in-memory cache
// caused external writes (CLI scripts, separate processes) to be silently
// clobbered by the next server flush. Re-reading on every access is slow
// but always correct; the SQLite backend is the recommended long-term
// replacement and is selected automatically when better-sqlite3 is available.
function getDb() { return read(); }
function flushDb(db) { write(db); }
let dirty = false;
function markDirty() { dirty = true; }

export function getUserById(id) { const db = getDb(); return db.users.find((u) => u.id === id) || null; }
export function getUserByEmail(email) { const db = getDb(); return db.users.find((u) => u.email === email) || null; }

export function getUserCounts() {
  const db = getDb();
  const now = Date.now();
  let pro = 0;
  for (const u of db.users) {
    if (u.plan === 'pro' && (u.plan_expires_at == null || u.plan_expires_at > now)) pro++;
  }
  return { total: db.users.length, pro };
}

export function listUsers() {
  const db = getDb();
  return db.users
    .map((u) => ({ id: u.id, email: u.email, plan: u.plan,
      planExpiresAt: u.plan_expires_at, referralCode: u.referral_code, createdAt: u.created_at }))
    .sort((a, b) => b.createdAt - a.createdAt);
}

export function createUser({ email, passwordHash, referredBy }) {
  const db = getDb();
  const referral = email.split('@')[0].replace(/[^a-zA-Z0-9]/g, '').toUpperCase().slice(0, 8) +
    crypto.randomBytes(2).toString('hex').toUpperCase();
  const user = {
    id: Date.now() + Math.floor(Math.random() * 1000),
    email, password_hash: passwordHash, plan: 'free', plan_expires_at: null,
    referral_code: referral, referred_by: referredBy || null, created_at: Date.now(),
  };
  db.users.push(user); flushDb(db);
  return user;
}

export function isPro(user) {
  return user.plan === 'pro' && (user.plan_expires_at == null || user.plan_expires_at > Date.now());
}

export function getWatchlist(userId) {
  const db = getDb();
  return db.watchlist.filter((w) => w.user_id === userId).sort((a, b) => b.created_at - a.created_at);
}
export function addWatchlist(userId, symbol) {
  const db = getDb();
  if (db.watchlist.some((w) => w.user_id === userId && w.symbol === symbol.toUpperCase())) return null;
  const row = { id: Date.now(), user_id: userId, symbol: symbol.toUpperCase(), created_at: Date.now() };
  db.watchlist.push(row); flushDb(db);
  return row;
}
export function removeWatchlist(userId, symbol) {
  const db = getDb();
  db.watchlist = db.watchlist.filter((w) => !(w.user_id === userId && w.symbol === symbol.toUpperCase()));
  flushDb(db);
}

export function createPayment({ userId, invoiceCode, network, toAddress, amountUsd, plan, durationDays }) {
  const db = getDb();
  const row = {
    id: Date.now(), user_id: userId, invoice_code: invoiceCode, network, to_address: toAddress,
    amount_usd: amountUsd, plan, duration_days: durationDays, status: 'pending',
    tx_hash: null, tx_amount: null, confirmations: 0, created_at: Date.now(), paid_at: null,
  };
  db.payments.push(row); flushDb(db);
  return row;
}
export function getPaymentsByUser(userId) {
  const db = getDb();
  return db.payments.filter((p) => p.user_id === userId).sort((a, b) => b.created_at - a.created_at).slice(0, 50);
}
export function getPendingPayments() {
  const db = getDb();
  return db.payments.filter((p) => p.status === 'pending');
}
export function updatePaymentStatus(id, updates) {
  const db = getDb();
  const p = db.payments.find((x) => x.id === id);
  if (!p) return null;
  Object.assign(p, updates); flushDb(db);
  return p;
}
export function updateUserPlan(userId, plan, expiresAt) {
  const db = getDb();
  const u = db.users.find((x) => x.id === userId);
  if (!u) return null;
  u.plan = plan; u.plan_expires_at = expiresAt;
  flushDb(db);
  return u;
}
export function resetUserPassword(email, passwordHash) {
  const db = getDb();
  const u = db.users.find((x) => x.email.toLowerCase() === String(email).toLowerCase());
  if (!u) return null;
  u.password_hash = passwordHash;
  flushDb(db);
  return u;
}
export function setPasswordReset(email, code, expiresAt) {
  const db = getDb();
  const u = db.users.find((x) => x.email.toLowerCase() === String(email).toLowerCase());
  if (!u) return null;
  u.reset_code = code; u.reset_expires_at = expiresAt;
  flushDb(db);
  return u;
}
export function getUserByResetCode(code) {
  const db = getDb();
  return db.users.find((u) => u.reset_code === code && u.reset_expires_at && u.reset_expires_at > Date.now()) || null;
}
export function clearPasswordReset(email) {
  const db = getDb();
  const u = db.users.find((x) => x.email.toLowerCase() === String(email).toLowerCase());
  if (!u) return null;
  delete u.reset_code; delete u.reset_expires_at;
  flushDb(db);
  return u;
}
export function cacheMarkets(exchangeId, markets) {
  const db = getDb();
  const idx = db.exchanges_cache.findIndex((e) => e.exchange === exchangeId);
  const row = { exchange: exchangeId, markets_json: JSON.stringify(markets), updated_at: Date.now() };
  if (idx >= 0) db.exchanges_cache[idx] = row; else db.exchanges_cache.push(row);
  flushDb(db);
}
export function getCachedMarkets(exchangeId) {
  const db = getDb();
  const row = db.exchanges_cache.find((e) => e.exchange === exchangeId);
  return row ? JSON.parse(row.markets_json) : null;
}
export function addScanHistory(opportunities, durationMs, exchangesCount) {
  const db = getDb();
  db.scan_history.push({
    id: Date.now(), scanned_at: Date.now(), opportunities, duration_ms: durationMs, exchanges: exchangesCount,
  });
  if (db.scan_history.length > 500) db.scan_history = db.scan_history.slice(-500);
  flushDb(db);
}
