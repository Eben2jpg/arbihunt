import { useEffect, useState, useRef } from 'react';
import { Link } from 'react-router-dom';
import { api, useAuth, WS_URL } from '../api';
import { Crown, RefreshCw, ArrowRightLeft, Wallet, AlertTriangle, X, ArrowRight, Users, Calculator, Pause, Play } from 'lucide-react';
import ProfitCalculator from './ProfitCalculator';

export default function Dashboard() {
  const { user, refreshUser } = useAuth();
  const [opps, setOpps] = useState([]);
  const [counts, setCounts] = useState(null);
  const [loading, setLoading] = useState(true);
  const [allExchanges, setAllExchanges] = useState([]);
  const [selectedExchanges, setSelectedExchanges] = useState([]);
  const [showFilters, setShowFilters] = useState(false);
  const wsRef = useRef(null);

  const [adminEmail, setAdminEmail] = useState('');
  const [adminDays, setAdminDays] = useState('');
  const [adminMsg, setAdminMsg] = useState('');
  const [adminErr, setAdminErr] = useState('');
  const [adminUsers, setAdminUsers] = useState(null);
  const [users, setUsers] = useState(null);
  const [pwCurrent, setPwCurrent] = useState('');
  const [pwNew, setPwNew] = useState('');
  const [pwConfirm, setPwConfirm] = useState('');
  const [pwMsg, setPwMsg] = useState('');
  const [pwErr, setPwErr] = useState('');
  const [showPwForm, setShowPwForm] = useState(false);
  const [showCalc, setShowCalc] = useState(false);
  const [paused, setPaused] = useState(false);
  const [now, setNow] = useState(Date.now());

  // Live clock for the expiry countdown + background plan refresh.
  useEffect(() => {
    const clock = setInterval(() => setNow(Date.now()), 1000);
    const planRefresh = setInterval(() => { try { refreshUser(); } catch (_e) {} }, 30000);
    return () => { clearInterval(clock); clearInterval(planRefresh); };
  }, []);

  useEffect(() => {
    api.get('/opportunities/counts').then((r) => setCounts(r.data)).catch(() => {});
    api.get('/status/exchanges').then((r) => setAllExchanges(r.data.exchanges || [])).catch(() => {});
    api.get('/status/stats').then((r) => setUsers(r.data.users)).catch(() => {});

    fetchOpportunities([]);

    const ws = new WebSocket(WS_URL);
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        if (msg.type === 'opportunities' || msg.type === 'tick') {
          // When paused, the user wants the current view to stay frozen.
          // Manual refresh / resume is the only path to re-fetch.
          if (!paused) fetchOpportunities(selectedExchanges);
        }
      } catch (_) {}
    };
    ws.onerror = () => {}; // don't bubble — Vite proxy errors are common during backend scans
    wsRef.current = ws;

    // Auto-refresh is suppressed while paused so a trader can park on a
    // token, copy the name, and not lose it to a tick.
    const t = paused ? null : setInterval(() => {
      fetchOpportunities(selectedExchanges);
    }, 25000);

    return () => { try { ws.close(); } catch (_) {} if (t) clearInterval(t); };
  }, [selectedExchanges, paused]);

  const isPro = user?.plan === 'pro';
  const isOwner = user?.isOwner;

  // PRO expiry: show a warning when 24h (or less) remain, and a renewal prompt once it resets.
  const proExpiresAt = user?.planExpiresAt || null;
  const msLeft = proExpiresAt ? proExpiresAt - now : null;
  const expiringSoon = isPro && msLeft != null && msLeft > 0 && msLeft <= 86400000;
  const proEnded = proExpiresAt != null && msLeft != null && msLeft <= 0;

  function formatCountdown(totalMs) {
    const total = Math.max(0, Math.floor(totalMs / 1000));
    const d = Math.floor(total / 86400);
    const h = Math.floor((total % 86400) / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    const pad = (n) => String(n).padStart(2, '0');
    return d > 0 ? `${d}d ${pad(h)}h ${pad(m)}m ${pad(s)}s` : `${pad(h)}h ${pad(m)}m ${pad(s)}s`;
  }

  function fetchOpportunities(exchanges) {
    const params = exchanges.length ? { params: { exchanges: exchanges.join(',') } } : {};
    api.get('/opportunities', params)
      .then((r) => { setOpps(r.data.opportunities || []); setLoading(false); })
      .catch((e) => { setLoading(false); /* 401 is fine — RequireAuth handles it */ });
  }

  function toggleExchange(id) {
    setSelectedExchanges((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }

  function clearFilters() {
    setSelectedExchanges([]);
  }

  async function upgradeSelf() {
    setAdminMsg(''); setAdminErr('');
    try {
      const r = await api.post('/admin/self');
      setAdminMsg(r.data.message || 'Your account is now PRO');
    } catch (e) {
      setAdminErr(e.response?.data?.error || 'Failed to upgrade');
    }
  }

  async function upgradeEmail() {
    setAdminMsg(''); setAdminErr('');
    if (!adminEmail.trim()) { setAdminErr('Enter an email to upgrade'); return; }
    try {
      const r = await api.post('/admin/upgrade', { email: adminEmail.trim(), days: adminDays });
      setAdminMsg(`${r.data.user.email} is now PRO${r.data.user.days ? ` for ${r.data.user.days} days` : ' (lifetime)'}`);
    } catch (e) {
      setAdminErr(e.response?.data?.error || 'Failed to upgrade email');
    }
  }

  async function loadUsers() {
    setAdminMsg(''); setAdminErr('');
    try {
      const r = await api.get('/admin/users');
      setAdminUsers(r.data.users);
    } catch (e) {
      setAdminErr(e.response?.data?.error || 'Failed to load users');
    }
  }

  async function changePassword(e) {
    e.preventDefault();
    setPwMsg(''); setPwErr('');
    if (!pwCurrent || !pwNew || !pwConfirm) { setPwErr('Fill in all three fields'); return; }
    if (pwNew !== pwConfirm) { setPwErr('New passwords do not match'); return; }
    if (pwNew.length < 8) { setPwErr('New password must be at least 8 characters'); return; }
    try {
      const r = await api.post('/auth/change-password', { currentPassword: pwCurrent, newPassword: pwNew });
      setPwMsg(r.data.message || 'Password updated');
      setPwCurrent(''); setPwNew(''); setPwConfirm('');
    } catch (err) {
      setPwErr(err.response?.data?.error || 'Failed to change password');
    }
  }

  return (
    <div className="min-h-screen">
      <header className="border-b border-slate-800">
        <div className="mx-auto max-w-7xl px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <ArrowRightLeft className="w-6 h-6 text-emerald-400" />
            <h1 className="text-xl font-bold">ArbiHunt Clone</h1>
          </div>
          <div className="flex items-center gap-4">
            <button onClick={() => setShowCalc(true)} className="text-sm text-slate-300 hover:text-white flex items-center gap-1">
              <Calculator className="w-4 h-4" /> Calculator
            </button>
            <button onClick={() => setShowFilters(!showFilters)} className="text-sm text-slate-300 hover:text-white">
              {showFilters ? 'Hide filters' : 'Filter exchanges'}
            </button>
            <button onClick={() => setShowPwForm(!showPwForm)} className="text-sm text-slate-300 hover:text-white">
              Password
            </button>
            <Link to="/invoices" className="text-sm text-slate-300 hover:text-white">Invoices</Link>
            <span className="text-sm text-slate-300">{user?.email}</span>
            {isOwner && <span className="px-2 py-1 bg-violet-500/20 text-violet-300 text-xs rounded">OWNER</span>}
            {isPro ? <span className="px-2 py-1 bg-emerald-500/20 text-emerald-300 text-xs rounded">PRO</span> : <span className="px-2 py-1 bg-slate-800 text-slate-300 text-xs rounded">FREE</span>}
          </div>
        </div>
      </header>

      {showFilters && (
        <div className="border-b border-slate-800 bg-slate-900/50">
          <div className="mx-auto max-w-7xl px-6 py-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-medium text-slate-200">Exchange filter</h3>
              {selectedExchanges.length > 0 && (
                <button onClick={clearFilters} className="text-xs text-slate-400 hover:text-white flex items-center gap-1">
                  <X className="w-3 h-3" /> Clear
                </button>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              {allExchanges.map((ex) => (
                <button
                  key={ex.id}
                  onClick={() => toggleExchange(ex.id)}
                  className={`px-3 py-1 rounded-lg text-xs border transition-colors ${
                    selectedExchanges.includes(ex.id)
                      ? 'bg-emerald-500/20 border-emerald-500 text-emerald-300'
                      : 'bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700'
                  }`}
                >
                  {ex.name}
                </button>
              ))}
            </div>
            {selectedExchanges.length > 0 && (
              <p className="text-xs text-slate-400 mt-2">Showing {selectedExchanges.length} selected exchange(s)</p>
            )}
          </div>
        </div>
      )}

      {isOwner && (
        <div className="border-b border-violet-800 bg-violet-950/30">
          <div className="mx-auto max-w-7xl px-6 py-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-violet-200 flex items-center gap-2">
                <Crown className="w-4 h-4" /> Owner control panel
              </h3>
              <span className="text-xs text-violet-300/70">Restricted to owner email</span>
            </div>
            <div className="grid md:grid-cols-2 gap-4">
              <div className="p-4 border border-violet-800 rounded-lg bg-slate-950/40">
                <p className="text-xs text-violet-200 mb-2">Upgrade any user by email</p>
                <div className="flex flex-wrap gap-2">
                  <input
                    value={adminEmail}
                    onChange={(e) => setAdminEmail(e.target.value)}
                    placeholder="user@email.com"
                    className="px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-sm flex-1 min-w-[200px]"
                  />
                  <input
                    value={adminDays}
                    onChange={(e) => setAdminDays(e.target.value)}
                    placeholder="days (blank = lifetime)"
                    type="number"
                    min="0"
                    className="px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-sm w-36"
                  />
                  <button onClick={upgradeEmail} className="px-4 py-2 bg-violet-600 text-white text-sm rounded-lg font-medium hover:bg-violet-500">
                    Upgrade
                  </button>
                </div>
                {adminMsg && <p className="text-emerald-300 text-xs mt-2">{adminMsg}</p>}
                {adminErr && <p className="text-red-300 text-xs mt-2">{adminErr}</p>}
              </div>
              <div className="p-4 border border-violet-800 rounded-lg bg-slate-950/40">
                <p className="text-xs text-violet-200 mb-2">Your own account</p>
                <button onClick={upgradeSelf} className="px-4 py-2 bg-violet-600 text-white text-sm rounded-lg font-medium hover:bg-violet-500">
                  {isPro ? 'Set my account to PRO (lifetime)' : 'Upgrade my account to PRO'}
                </button>
                {isPro && <p className="text-emerald-300 text-xs mt-2">You are already PRO.</p>}
              </div>
              <div className="p-4 border border-violet-800 rounded-lg bg-slate-950/40">
                <p className="text-xs text-violet-200 mb-2">Registered accounts</p>
                <button onClick={() => { adminUsers ? setAdminUsers(null) : loadUsers(); }} className="px-4 py-2 bg-violet-600 text-white text-sm rounded-lg font-medium hover:bg-violet-500">
                  {adminUsers ? 'Hide users' : 'List users'}
                </button>
              </div>
            </div>
            {adminUsers && (
              <div className="mt-4 p-4 border border-violet-800 rounded-lg bg-slate-950/40">
                <p className="text-xs text-violet-200 mb-2">{adminUsers.length} account(s)</p>
                <div className="space-y-1 text-sm font-mono">
                  {adminUsers.map((u) => (
                    <div key={u.id} className="flex flex-wrap items-center justify-between gap-2 py-1 px-2">
                      <span className="text-slate-200 break-all">{u.email}</span>
                      <span className={`text-xs ${u.plan === 'pro' && (!u.planExpiresAt || u.planExpiresAt > Date.now()) ? 'text-emerald-300' : 'text-slate-400'}`}>
                        {u.plan === 'pro' && (!u.planExpiresAt || u.planExpiresAt > Date.now()) ? 'PRO' : 'free'}{u.planExpiresAt ? ` · ${new Date(u.planExpiresAt).toLocaleDateString()}` : (u.plan === 'pro' ? ' · lifetime' : '')}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {showPwForm && (
        <div className="border-b border-slate-800 bg-slate-900/50">
          <div className="mx-auto max-w-7xl px-6 py-4">
            <form onSubmit={changePassword} className="p-4 border border-slate-800 rounded-lg bg-slate-950/40 max-w-xl">
              <h3 className="text-sm font-semibold text-slate-200 mb-3">Change your password</h3>
              <div className="space-y-3">
                <input
                  type="password"
                  placeholder="Current password"
                  value={pwCurrent}
                  onChange={(e) => setPwCurrent(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-sm text-slate-100 focus:outline-none focus:border-emerald-500"
                />
                <input
                  type="password"
                  placeholder="New password (min 8 characters)"
                  value={pwNew}
                  onChange={(e) => setPwNew(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-sm text-slate-100 focus:outline-none focus:border-emerald-500"
                />
                <input
                  type="password"
                  placeholder="Confirm new password"
                  value={pwConfirm}
                  onChange={(e) => setPwConfirm(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-sm text-slate-100 focus:outline-none focus:border-emerald-500"
                />
                {pwErr && <p className="text-xs text-red-400">{pwErr}</p>}
                {pwMsg && <p className="text-xs text-emerald-400">{pwMsg}</p>}
                <button type="submit" className="px-4 py-2 bg-emerald-500 text-white text-sm rounded-lg font-medium hover:bg-emerald-400">
                  Update password
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <main className="mx-auto max-w-7xl px-6 py-8">
        {/* Free-plan upsell banner. Shown only to free users. Lists the
            free-plan limits, the cheapest plan price, and CTAs to upgrade
            or see all plans. */}
        {!isPro && (
          <div className="mb-4 p-4 border border-amber-700/50 bg-amber-950/40 rounded-lg flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-start gap-2 text-amber-200 text-sm">
              <Crown className="w-4 h-4 text-amber-400 mt-0.5 shrink-0" />
              <div>
                <div className="font-semibold">Free plan — opportunities from 0.10% up to 1.5% spread are shown.</div>
                <div className="text-amber-300/80 text-xs mt-1">
                  Anything above 1.5% is PRO-only. Upgrade to PRO from just 7 USDT/week and unlock every spread (1.5% and above), advanced filters, and the profit calculator.
                </div>
              </div>
            </div>
            <div className="flex gap-2 shrink-0">
              <Link to="/pricing" className="text-xs px-3 py-1.5 border border-emerald-600 text-emerald-300 rounded-md hover:bg-emerald-950/40">
                See plans
              </Link>
              <Link to="/checkout?plan=1-week" className="text-xs px-3 py-1.5 bg-emerald-500 text-white rounded-md font-medium hover:bg-emerald-400">
                Unlock PRO now — Pay 7 USDT
              </Link>
            </div>
          </div>
        )}

        {/* Live platform usage strip */}
        <div className="mb-6 grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="p-4 rounded-xl border border-slate-800 bg-slate-900/40">
            <div className="flex items-center gap-2 text-slate-400 text-sm"><Users className="w-4 h-4" /> People using the platform</div>
            <div className="text-2xl font-bold mt-1">{users?.total ?? '—'}</div>
            <div className="text-xs text-emerald-300">{users?.pro ?? 0} PRO</div>
          </div>
          <div className="p-4 rounded-xl border border-slate-800 bg-slate-900/40">
            <div className="text-slate-400 text-sm">Exchanges live</div>
            <div className="text-2xl font-bold mt-1">{counts?.exchanges ?? '—'}</div>
            <div className="text-xs text-slate-400">USDT markets</div>
          </div>
          <div className="p-4 rounded-xl border border-slate-800 bg-slate-900/40">
            <div className="text-slate-400 text-sm">Tokens compared</div>
            <div className="text-2xl font-bold mt-1">{counts?.tokens ?? '—'}</div>
            <div className="text-xs text-slate-400">cross-listed</div>
          </div>
          <div className="p-4 rounded-xl border border-slate-800 bg-slate-900/40">
            <div className="text-slate-400 text-sm">Opportunities live</div>
            {/* Always reflect the actual list the user is looking at — not the
                pre-filter server count. After PRO gating or exchange filtering
                the visible row count can be smaller, and the panel must match. */}
            <div className="text-2xl font-bold mt-1 text-emerald-400">{opps.length}</div>
            <div className="text-xs text-slate-400">{counts?.scansDone ?? 0} scans done</div>
          </div>
        </div>

        {expiringSoon && (
          <div className="mb-6 p-4 border border-amber-600/60 bg-gradient-to-r from-amber-950/40 to-emerald-950/20 rounded-lg">
            <div className="flex items-start gap-3 flex-wrap">
              <AlertTriangle className="w-5 h-5 text-amber-400 mt-0.5" />
              <div className="flex-1">
                <p className="text-amber-100 text-sm font-medium">
                  ⏳ Your PRO plan ends in <span className="font-black tabular-nums">{formatCountdown(msLeft)}</span>. Renew now so you don't lose access when it resets.
                </p>
                <Link to="/checkout?plan=1-week" className="inline-flex items-center gap-1 mt-2 px-4 py-2 bg-emerald-500 text-white text-sm rounded-lg font-medium hover:bg-emerald-400">
                  Renew PRO now <ArrowRight className="w-4 h-4" />
                </Link>
              </div>
            </div>
          </div>
        )}

        {proEnded && (
          <div className="mb-6 p-4 border border-slate-700 bg-slate-900/60 rounded-lg">
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-amber-400 mt-0.5" />
              <div className="flex-1">
                <p className="text-amber-100 text-sm font-medium">Your PRO plan has ended. Upgrade again to keep full access to every opportunity.</p>
                <Link to="/checkout?plan=1-week" className="inline-flex items-center gap-1 mt-2 px-4 py-2 bg-emerald-500 text-white text-sm rounded-lg font-medium hover:bg-emerald-400">
                  Renew PRO <ArrowRight className="w-4 h-4" />
                </Link>
              </div>
            </div>
          </div>
        )}

        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-2xl font-bold">Live Opportunities</h2>
            <p className="text-slate-400 text-sm mt-1">
              {opps.length} opportunity{opps.length === 1 ? '' : 'ies'} shown · {counts?.tokens || 0} tokens · {counts?.exchanges || 0} exchanges · {counts?.scansDone || 0} scans
            </p>
            {paused && (
              <p className="text-amber-300 text-xs mt-1 flex items-center gap-1">
                <Pause className="w-3 h-3" /> Auto-refresh paused — view is frozen until you click Resume.
              </p>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPaused((p) => !p)}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm ${
                paused
                  ? 'bg-amber-500/20 text-amber-200 border border-amber-500/40 hover:bg-amber-500/30'
                  : 'bg-slate-800 text-slate-200 hover:bg-slate-700'
              }`}
              title={paused ? 'Resume auto-refresh' : 'Pause auto-refresh'}
            >
              {paused ? <Play className="w-4 h-4" /> : <Pause className="w-4 h-4" />}
              {paused ? 'Resume' : 'Pause'}
            </button>
            <button onClick={() => fetchOpportunities(selectedExchanges)} className="flex items-center gap-2 px-4 py-2 bg-slate-800 rounded-lg text-sm hover:bg-slate-700">
              <RefreshCw className="w-4 h-4" /> Refresh
            </button>
          </div>
        </div>

        {!isPro && (
          <div className="mb-6 p-4 border border-amber-700/50 bg-amber-950/30 rounded-lg flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-amber-400 mt-0.5" />
            <div className="flex-1">
              <p className="text-amber-200 text-sm font-medium">Free plan — opportunities from 0.10% up to 1.5% spread are shown.</p>
              <p className="text-amber-200 text-sm font-medium">Anything above 1.5% is PRO-only.</p>
              <p className="text-amber-300/80 text-xs mt-1">
                Upgrade to PRO from just <span className="font-semibold">7 USDT/week</span> and unlock every spread (1.5% and above), advanced filters, and the profit calculator.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Link to="/pricing" className="inline-flex items-center gap-1 px-4 py-2 bg-emerald-500 text-white text-sm rounded-lg font-medium hover:bg-emerald-400">
                  Unlock PRO now <ArrowRight className="w-4 h-4" />
                </Link>
                <Link to="/checkout?plan=1-week" className="inline-flex items-center gap-1 px-4 py-2 border border-emerald-600 text-emerald-300 text-sm rounded-lg hover:bg-emerald-950/40">
                  Pay 22 USDT for 1 month
                </Link>
              </div>
            </div>
          </div>
        )}

        {loading ? (
          <p className="text-slate-400">Scanning exchanges...</p>
        ) : opps.length === 0 ? (
          <div className="p-8 border border-slate-800 rounded-xl bg-slate-900/40 text-center">
            <p className="text-slate-300 font-medium">No opportunities right now</p>
            <p className="text-slate-500 text-sm mt-1">
              The scanner is comparing every real USDT pair across all connected exchanges and refreshes every ~30s.
              Spreads open and close constantly — check back shortly.
            </p>
          </div>
        ) : (
          <RankedBoard opps={opps} />
        )}
      </main>

      <ProfitCalculator
        open={showCalc}
        onClose={() => setShowCalc(false)}
        opportunities={opps}
        exchanges={allExchanges}
        isPro={isPro}
      />
    </div>
  );
}

function fmtFee(n) {
  if (n == null || !isFinite(n)) return '—';
  if (n === 0) return '0';
  if (n < 0.001) return n.toPrecision(4);
  if (n < 1) return n.toFixed(4);
  return Number(n).toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function fmtUsd(n) {
  if (n == null || !isFinite(n)) return '—';
  return Number(n).toLocaleString(undefined, { maximumFractionDigits: 0 });
}

function RankedBoard({ opps }) {
  // Guard against any non-finite values on the live dataset (stale cache,
  // partial scan results, etc). Without this NaN can sneak into barW and
  // crash the React subtree.
  const safePcts = (opps || [])
    .map((o) => Number(o?.netProfitPct))
    .filter((n) => Number.isFinite(n));
  const topPct = safePcts.length ? Math.max(...safePcts, 0.01) : 0.01;
  const medal = (r) => (r === 1 ? '🥇' : r === 2 ? '🥈' : r === 3 ? '🥉' : null);
  // Count rows the server has flagged as `gated: true` (free-user >=2% opps).
  // Surfaced at the bottom of the board so free users know how many PRO-tier
  // opportunities exist that they cannot see in full.
  const gatedCount = (opps || []).filter((o) => o && o.gated === true).length;
  return (
    <div className="space-y-3">
      {/* Header row */}
      <div className="hidden md:flex items-center px-5 py-2 text-xs uppercase tracking-wide text-slate-500 border-b border-slate-800">
        <div className="w-16">Rank</div>
        <div className="w-40">Token</div>
        <div className="flex-1">Buy → Sell</div>
        <div className="w-24 text-right">Net %</div>
        <div className="w-28 text-right">Net profit</div>
        <div className="w-32 text-right">Liquidity / Network</div>
      </div>

      {opps.map((op, i) => {
        const rank = op.rank || i + 1;
        const pct = Number(op.netProfitPct);
        const safePct = Number.isFinite(pct) ? pct : 0;
        const barW = Math.max(4, Math.min(100, (safePct / topPct) * 100));
        const hot = rank === 1;
        const gated = op.gated === true;
        return (
          <div
            key={op.id}
            className={`relative overflow-hidden p-5 border rounded-xl transition-colors ${
              hot && !gated ? 'border-emerald-500/60 bg-emerald-950/20' : 'border-slate-800 bg-slate-900/40 hover:bg-slate-900/70'
            }`}
          >
            {/* strength bar */}
            <div
              className={`absolute left-0 top-0 h-full ${hot && !gated ? 'bg-emerald-500/10' : 'bg-emerald-500/5'}`}
              style={{ width: `${barW}%` }}
            />
            {op.latokenWarning && !gated && (
              <div className="relative flex items-center gap-2 mb-2 text-xs text-amber-400">
                <AlertTriangle className="w-3 h-3" />
                Latoken price may be stale — verify before trading
              </div>
            )}
            <div className={`relative flex flex-wrap items-center gap-4 ${gated ? 'blur-sm opacity-60 select-none' : ''}`}>
              {/* Rank */}
              <div className="w-14 flex items-center gap-1">
                <span className={`text-2xl font-black ${hot && !gated ? 'text-emerald-400' : rank <= 3 ? 'text-slate-100' : 'text-slate-400'}`}>
                  #{rank}
                </span>
                {medal(rank)}
              </div>

              {/* Token */}
              <div className="w-36">
                <div className="text-lg font-bold leading-tight">{op.base === '••••' ? '••••' : op.base}</div>
                <div className="text-xs text-slate-500">{op.symbol}</div>
              </div>

              {/* Route */}
              <div className="flex-1 min-w-[240px]">
                <div className="flex items-center gap-3 flex-wrap">
                  <div>
                    <div className="text-xs text-slate-500">BUY</div>
                    <div className="text-sm font-semibold text-emerald-300">{op.buyExchange}</div>
                    {op.buyPrice != null && <div className="text-xs text-slate-400 font-mono">${op.buyPrice.toFixed(6)}</div>}
                  </div>
                  <ArrowRightLeft className="w-4 h-4 text-slate-600" />
                  <div>
                    <div className="text-xs text-slate-500">SELL</div>
                    <div className="text-sm font-semibold text-sky-300">{op.sellExchange}</div>
                    {op.sellPrice != null && <div className="text-xs text-slate-400 font-mono">${op.sellPrice.toFixed(6)}</div>}
                  </div>
                </div>
              </div>

              {/* Net % + bar */}
              <div className="w-24 text-right">
                <div className={`text-2xl font-bold ${hot && !gated ? 'text-emerald-300' : 'text-emerald-400'}`}>
                  {pct.toFixed(2)}%
                </div>
                <div className="mt-1 h-1.5 w-full bg-slate-800 rounded-full overflow-hidden">
                  <div className="h-full bg-gradient-to-r from-emerald-600 to-emerald-400 rounded-full" style={{ width: `${barW}%` }} />
                </div>
              </div>

              {/* Card footer: Network (+ contract address when live),
                  Withdraw fee (tagged live/curated/est), per-leg Liquidity
                  and per-leg 24h Volume for BOTH exchanges. No example
                  profit dollar amount — profit depends on trader's capital. */}
              <div className="w-56 text-right text-xs space-y-0.5">
                {op.networkLabel && op.networkLabel !== 'Cross-chain' && op.networkLabel !== 'Network unknown' && (
                  <div>
                    <span className="inline-block px-1.5 py-0.5 rounded bg-slate-800 text-slate-300">
                      {op.networkLabel}{op.networkAssumed ? ' ⚠' : ''}
                    </span>
                    {op.contractAddress && (
                      <div className="mt-0.5 text-slate-500 font-mono text-[10px] break-all" title={op.contractAddress}>
                        {op.contractAddress.length > 22
                          ? op.contractAddress.slice(0, 10) + '…' + op.contractAddress.slice(-8)
                          : op.contractAddress}
                      </div>
                    )}
                  </div>
                )}
                {op.withdrawFee != null && (
                  <div className="text-slate-300">
                    Withdraw:{' '}
                    <span className="font-mono">
                      {op.feeSource === 'live' ? '' : (op.feeSource === 'estimated' ? '≈' : '~')}
                      {fmtFee(op.withdrawFee)}
                      {op.feeSource === 'live' ? '' : (op.feeSource === 'estimated' ? ' (est.)' : ' (curated)')}
                    </span>
                    {' '}
                    <span className={
                      op.feeSource === 'live' ? 'text-emerald-400' :
                      op.feeSource === 'estimated' ? 'text-amber-400' : 'text-slate-500'
                    }>
                      {op.feeSource === 'live' ? '✓ live' : op.feeSource === 'estimated' ? '· est' : '· curated'}
                    </span>
                    {op.base !== '••••' && <span className="text-slate-500"> {op.base}</span>}
                  </div>
                )}
                {op.buyLiquidityUsd != null && (
                  <div className="text-slate-500">Liq ({op.buyExchange}): ${fmtUsd(op.buyLiquidityUsd)}</div>
                )}
                {op.sellLiquidityUsd != null && (
                  <div className="text-slate-500">Liq ({op.sellExchange}): ${fmtUsd(op.sellLiquidityUsd)}</div>
                )}
                {op.buyVolume24hUsd != null && (
                  <div className="text-slate-500">Vol 24h ({op.buyExchange}): ${fmtUsd(op.buyVolume24hUsd)}</div>
                )}
                {op.sellVolume24hUsd != null && (
                  <div className="text-slate-500">Vol 24h ({op.sellExchange}): ${fmtUsd(op.sellVolume24hUsd)}</div>
                )}
              </div>
            </div>
            {gated && (
              // PRO-only row — overlay the blurred content with an
              // upgrade CTA so free users see a real opportunity is there
              // but cannot read the token, exchanges, or prices.
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <Link
                  to="/pricing"
                  className="pointer-events-auto inline-flex items-center gap-2 px-4 py-2 bg-amber-500/95 text-slate-900 rounded-lg text-sm font-semibold shadow-lg shadow-amber-900/30 hover:bg-amber-400"
                >
                  <Crown className="w-4 h-4" />
                  Upgrade to PRO to reveal
                </Link>
              </div>
            )}
          </div>
        );
      })}
      {gatedCount > 0 && (
        <div className="pt-2 text-center text-xs text-slate-500">
          {gatedCount} more opportunity{gatedCount === 1 ? '' : 'ies'} above 1.5% are hidden — <Link to="/pricing" className="text-amber-300 hover:text-amber-200 underline">upgrade to PRO</Link> to see them.
        </div>
      )}
    </div>
  );
}
