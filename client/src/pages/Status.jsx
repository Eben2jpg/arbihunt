import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { Users, Activity, Coins, Server, CheckCircle2, XCircle } from 'lucide-react';

export default function Status() {
  const [exchanges, setExchanges] = useState([]);
  const [stats, setStats] = useState(null);

  useEffect(() => {
    api.get('/status/exchanges').then((r) => setExchanges(r.data.exchanges));
    api.get('/status/stats').then((r) => setStats(r.data)).catch(() => {});
  }, []);

  const scanned = stats?.scannedExchanges || [];

  return (
    <div className="min-h-screen">
      <header className="border-b border-slate-800">
        <div className="mx-auto max-w-7xl px-6 py-4 flex items-center justify-between">
          <Link to="/" className="text-xl font-bold">ArbiHunt Clone</Link>
          <Link to="/pricing" className="text-sm text-slate-300 hover:text-white">Pricing</Link>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-6 py-8">
        <h1 className="text-2xl font-bold mb-6">Platform Status</h1>

        {/* Live user/scan stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          <div className="p-4 rounded-xl border border-slate-800 bg-slate-900/40">
            <div className="flex items-center gap-2 text-slate-400 text-sm"><Users className="w-4 h-4" /> Registrations</div>
            <div className="text-2xl font-bold mt-1">{stats?.users?.total ?? '—'}</div>
            <div className="text-xs text-emerald-300">{stats?.users?.pro ?? 0} PRO</div>
          </div>
          <div className="p-4 rounded-xl border border-slate-800 bg-slate-900/40">
            <div className="flex items-center gap-2 text-slate-400 text-sm"><Activity className="w-4 h-4" /> Opportunities</div>
            <div className="text-2xl font-bold mt-1">{stats?.opportunities ?? '—'}</div>
            <div className="text-xs text-slate-400">live right now</div>
          </div>
          <div className="p-4 rounded-xl border border-slate-800 bg-slate-900/40">
            <div className="flex items-center gap-2 text-slate-400 text-sm"><Coins className="w-4 h-4" /> Tokens scanned</div>
            <div className="text-2xl font-bold mt-1">{stats?.tokens ?? '—'}</div>
            <div className="text-xs text-slate-400">USDT pairs compared</div>
          </div>
          <div className="p-4 rounded-xl border border-slate-800 bg-slate-900/40">
            <div className="flex items-center gap-2 text-slate-400 text-sm"><Server className="w-4 h-4" /> Exchanges active</div>
            <div className="text-2xl font-bold mt-1">{scanned.length} <span className="text-slate-500 text-lg">/ {stats?.exchangesTotal ?? exchanges.length}</span></div>
            <div className="text-xs text-slate-400">with order-book data</div>
          </div>
        </div>

        <h2 className="text-lg font-bold mb-4">Exchange Coverage</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {exchanges.map((e) => {
            const st = scanned.includes(e.id) ? 'live' : 'offline';
            const Icon = st === 'live' ? CheckCircle2 : XCircle;
            return (
              <div key={e.id} className="p-3 border border-slate-800 rounded-lg bg-slate-900/50 text-sm flex items-center justify-between gap-2">
                <span>{e.name}</span>
                <Icon className={st === 'live' ? 'w-4 h-4 text-emerald-400' : 'w-4 h-4 text-red-400'} />
              </div>
            );
          })}
        </div>
        <p className="mt-6 text-xs text-slate-500">
          Exchanges showing green supplied order-book data in the last scan (live or via the cached market list). Red ones were unreachable and are retried automatically every scan.
        </p>
      </main>
    </div>
  );
}
