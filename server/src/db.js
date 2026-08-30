// Storage selector. Three backends, picked at boot in this order:
//   1. Supabase Postgres (when SUPABASE_DB_URL is set) — durable, free tier
//      friendly, works on hosts without a persistent disk (Render free).
//   2. SQLite (better-sqlite3) — fast, in-process.
//   3. JSON file — final fallback when no native bindings and no DB URL.
//
// All three export the same function surface. With Supabase or SQLite the
// functions are async; with the JSON fallback they are sync. The selector
// normalises this by wrapping the JSON backend in `async` shims so every
// call site can `await` uniformly.

let backend;
let backendName;

if (process.env.SUPABASE_DB_URL) {
  try {
    const mod = await import('./db.supabase.js');
    // Run schema bootstrap (idempotent) and a ping before exposing the
    // backend, so a wrong connection string fails fast at boot instead
    // of 500-ing on the first request.
    await mod.initSchema();
    await mod.ping();
    backend = mod;
    backendName = 'supabase (postgres)';
  } catch (e) {
    console.error('[db] supabase backend failed to init:', e?.message || e);
    throw e;
  }
} else {
  try {
    backend = await import('./db.sqlite.js');
    backendName = 'sqlite (better-sqlite3)';
  } catch (e) {
    console.warn('[db] sqlite backend unavailable, falling back to JSON:', e?.message || e);
    const jsonMod = await import('./db.json.js');
    // Wrap every export in an async shim so the rest of the codebase can
    // `await` uniformly. The underlying JSON store is already sync.
    const wrap = (name) => async (...args) => jsonMod[name](...args);
    backend = {
      isPro: jsonMod.isPro,
      getUserById: wrap('getUserById'),
      getUserByEmail: wrap('getUserByEmail'),
      createUser: wrap('createUser'),
      getUserCounts: wrap('getUserCounts'),
      listUsers: wrap('listUsers'),
      updateUserPlan: wrap('updateUserPlan'),
      resetUserPassword: wrap('resetUserPassword'),
      setPasswordReset: wrap('setPasswordReset'),
      getUserByResetCode: wrap('getUserByResetCode'),
      clearPasswordReset: wrap('clearPasswordReset'),
      getWatchlist: wrap('getWatchlist'),
      addWatchlist: wrap('addWatchlist'),
      removeWatchlist: wrap('removeWatchlist'),
      createPayment: wrap('createPayment'),
      getPaymentsByUser: wrap('getPaymentsByUser'),
      getPendingPayments: wrap('getPendingPayments'),
      updatePaymentStatus: wrap('updatePaymentStatus'),
      cacheMarkets: wrap('cacheMarkets'),
      getCachedMarkets: wrap('getCachedMarkets'),
      addScanHistory: wrap('addScanHistory'),
    };
    backendName = 'json (file)';
  }
}

console.log(`[db] backend: ${backendName}`);

export const {
  getUserById, getUserByEmail, getUserCounts, listUsers, createUser, isPro,
  getWatchlist, addWatchlist, removeWatchlist,
  createPayment, getPaymentsByUser, getPendingPayments, updatePaymentStatus,
  updateUserPlan, resetUserPassword,
  setPasswordReset, getUserByResetCode, clearPasswordReset,
  cacheMarkets, getCachedMarkets, addScanHistory,
} = backend;
