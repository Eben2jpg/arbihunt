// Storage selector. Prefers SQLite (better-sqlite3) for speed + concurrency.
// Falls back to a JSON file when the native binding cannot be loaded (e.g.
// no MSVC toolchain on Windows). Both backends export the same surface; call
// sites don't need to know which one is active.
//
// At boot, look for [db] lines in the log to confirm which backend is live.

let backend;
try {
  backend = await import('./db.sqlite.js');
  console.log('[db] backend: sqlite (better-sqlite3)');
} catch (e) {
  console.warn('[db] sqlite backend unavailable, falling back to JSON:', e?.message || e);
  backend = await import('./db.json.js');
  console.log('[db] backend: json (file)');
}

export const {
  getUserById, getUserByEmail, getUserCounts, listUsers, createUser, isPro,
  getWatchlist, addWatchlist, removeWatchlist,
  createPayment, getPaymentsByUser, getPendingPayments, updatePaymentStatus,
  updateUserPlan, resetUserPassword,
  setPasswordReset, getUserByResetCode, clearPasswordReset,
  cacheMarkets, getCachedMarkets, addScanHistory,
} = backend;
